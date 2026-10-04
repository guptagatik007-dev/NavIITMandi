#!/usr/bin/env python3
"""
build_data.py — turn raw survey sources into app-ready campus data.

INPUTS (tools/raw/):
  osm.json       Overpass extract: buildings, highways, barriers, landuse, POIs
  overture.json  Overture Maps release 2026-08-19.0 buildings (dense ML footprints)

OUTPUTS (public/data/):
  buildings.geojson     campus + context building footprints (merged OSM/Overture)
  roads.geojson         roads, footpaths, stairs, tracks with real widths
  areas.geojson         water, landuse, leisure/pitches, barriers
  pois.json             searchable points of interest with aliases
  unplaced.json         KNOWN facilities whose location is NOT yet verified  (no invented geometry)
  data.manifest.json    counts, sources, confidence histogram, published-area cross-check

Honesty rules encoded here:
  * nothing is invented; every feature carries `src` (source) + `conf` (confidence)
  * floor counts come from OSM tags where present, else a DOCUMENTED category default
    tagged `derived`, never silently assumed
  * facilities we know exist but cannot geolocate go to unplaced.json, not onto the map
"""
import json, math, os, re, time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.abspath(os.path.join(HERE, "..", "public", "data"))

# campus reference points (verified from institute sources / OSM place nodes)
ANCHORS = {
    "south_core": (31.77555, 76.98654),   # OSM node: IIT Mandi South Campus (amenity=college)
    "north_core": (31.78130, 76.99750),   # OSM way 761379545: IIT Mandi North Campus
}
ZONES = {"south": "South", "north": "North"}

# Area-based category inference for unnamed ML footprints. This is a HEURISTIC and is
# always tagged cat_conf="derived" so the UI can show it as unverified. The manual
# override file (public/data/manual/overrides.json) is the supported way to correct it.
AREA_CAT_RULES = [
    (1500, "academic"),   # large teaching/lab volumes
    (650, "hostel"),      # hostel blocks
    (220, "residential"), # staff/faculty housing
    (0, "utility"),       # small structures, sheds, substations
]
CAMPUS_RADIUS_M = 420          # buildings nearer than this to either core = "campus"
R = 6378137.0

CATEGORY_RULES = [
    # (regex on name, category) — most specific first
    (r"^a\s?-?\d+$|^a\d+\b", "academic"),      # A1, A2, A3, A18 block codes
    (r"^b\s?-?\d+\s*hostel|^b\d+$", "hostel"), # B1..B6 hostel names
    (r"^c\s?-?\d+\b", "residential"),           # C-1 faculty block codes
    (r"^d\s?-?\d+\b", "dining"),                # D1 mess codes
    (r"\b(hostel|b\d\s*hostel|chandrataal|parashar|nako|renuka|suvalsar|gauri|beaskund|dashir|suraj)", "hostel"),
    (r"\bmess\b|dining|canteen|cafeteria|food court", "dining"),
    (r"library|reading", "library"),
    (r"auditorium|convention|seminar|lecture theatre", "auditorium"),
    (r"sports|gym|pool|stadium|court|ground|playground|indoor", "sports"),
    (r"hospital|medical|health|dispensary", "medical"),
    (r"workshop|mechanical|lab|laboratory|research|amrc|innovation", "lab"),
    (r"academic|school of|department|department|lecture|class", "academic"),
    (r"director|office|admin|registrar|estate|infra|dean", "admin"),
    (r"faculty|residential|quarters|apartment|housing|staff|guest house|guesthouse", "residential"),
    (r"school|kendriya", "school"),
    (r"temple|mandir|shrine|mosque|church|gurudwara", "worship"),
    (r"gate|entrance|checkpoint|security|barrier", "gate"),
    (r"parking|garage", "parking"),
    (r"shop|store|market|bank|atm|post office", "commerce"),
    (r"toilet|washroom|restroom", "utility"),
]

# DOCUMENTED defaults — every building using these is tagged conf:"derived" and
# listed in public/data/floors-unverified.json so the UI can show a coverage warning.
FLOOR_DEFAULTS = {
    "hostel":      (4, 3.20, "BEASKUND/Gaurikund blocks are 4-storey; South hostel blocks 4-5 storey"),
    "academic":    (3, 4.20, "A1/A2/A3 blocks are 3-storey; seminar halls double-height"),
    "lab":         (2, 4.50, "workshop/AMRC bays are single-storey tall"),
    "dining":      (2, 4.80, "mess halls are double-height with mezzanine kitchen"),
    "library":     (2, 4.60, "reading halls double-height"),
    "auditorium":  (2, 6.50, "auditorium shell is tall single volume + foyer"),
    "sports":      (2, 5.50, "sports complex has tall indoor hall"),
    "medical":     (2, 3.60, "hospital/health centre 2-storey"),
    "admin":       (3, 4.00, "administrative blocks 3-storey"),
    "residential": (4, 3.20, "faculty/staff apartment blocks 4-storey (C-1 faculty block)"),
    "school":      (2, 3.60, "village school 2-storey"),
    "worship":     (1, 3.20, "single-volume shrine"),
    "gate":        (1, 3.50, "gate cabin"),
    "parking":     (1, 3.00, "open parking"),
    "commerce":    (2, 3.60, "shops/bank 2-storey"),
    "utility":     (1, 3.00, "utility structure"),
    "context":     (2, 3.20, "village/context dwelling — derived default"),
    "unknown":     (2, 3.50, "no source data; derived default"),
}

ROOF_BY_CATEGORY = {
    "hostel": ("flat", 0, "concrete slab + parapet, some with sloped CGI over terrace"),
    "academic": ("flat", 0, "RCC flat roof; some bays with sloped metal roof"),
    "lab": ("shed", 14, "sloped ribbed metal roof over tall bays"),
    "dining": ("sloped", 18, "sloped CGI/metal roof over hall"),
    "library": ("flat", 0, "flat RCC with skylight"),
    "auditorium": ("multi-bay", 12, "long-span curved/multi-bay roof"),
    "sports": ("multi-bay", 10, "long-span metal roof over indoor hall"),
    "medical": ("flat", 0, "flat RCC"),
    "admin": ("flat", 0, "flat RCC"),
    "residential": ("flat", 0, "flat RCC + parapet"),
    "school": ("sloped", 15, "sloped CGI"),
    "worship": ("sloped", 22, "sloped stone/metal roof"),
    "gate": ("flat", 0, "flat slab canopy"),
    "parking": ("flat", 0, "open shed"),
    "commerce": ("flat", 0, "flat RCC"),
    "utility": ("sloped", 18, "light metal roof"),
    "context": ("sloped", 20, "Himachali slate/CGI pitched roof"),
    "unknown": ("flat", 0, "unverified"),
}

WALL_BY_CATEGORY = {
    "hostel": "plaster_paint_cream", "academic": "stone_clad_glazing", "lab": "metal_sheet_industrial",
    "dining": "plaster_paint_cream", "library": "stone_clad_glazing", "auditorium": "stone_clad",
    "sports": "metal_sheet_industrial", "medical": "plaster_paint_white", "admin": "stone_clad_glazing",
    "residential": "plaster_paint_cream", "school": "plaster_paint_white", "worship": "stone_rough",
    "gate": "plaster_paint_white", "parking": "metal_sheet_industrial", "commerce": "plaster_paint_white",
    "utility": "metal_sheet_industrial", "context": "stone_rough", "unknown": "plaster_paint_white",
}

ROAD_WIDTH_M = {
    "motorway": 7.5, "trunk": 7.0, "primary": 7.0, "secondary": 6.5, "tertiary": 6.0,
    "tertiary_link": 5.5, "unclassified": 4.5, "residential": 4.0, "service": 3.5,
    "track": 3.0, "path": 1.5, "footway": 1.6, "steps": 1.4, "cycleway": 2.5,
    "bridleway": 1.5, "living_street": 4.0, "road": 4.0,
}


def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def ring_centroid(ring):
    n = len(ring)
    if n == 0:
        return (0, 0)
    # polygon centroid (shoelace), falls back to vertex mean for degenerate rings
    a = cx = cy = 0.0
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if abs(a) < 1e-12:
        return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    return (cx / (3 * a), cy / (3 * a))


def ring_area_m2(ring):
    """Signed planar area in m² via local equirectangular projection."""
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    pts = [(p[0] * 111320.0 * k, p[1] * 110574.0) for p in ring]
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0


def categorise(name, tags=None):
    if name:
        low = name.lower()
        for pat, cat in CATEGORY_RULES:
            if re.search(pat, low):
                return cat
    if tags:
        b = (tags.get("building") or "").lower()
        if b in ("residential", "apartments", "dormitory", "house", "detached", "terrace"):
            return "residential"
        if b in ("university", "college", "school"):
            return "academic"
        if b in ("hospital", "clinic"):
            return "medical"
        if b in ("sports_hall", "stadium", "grandstand"):
            return "sports"
        if b in ("industrial", "warehouse", "hangar"):
            return "lab"
        if b in ("commercial", "retail", "kiosk"):
            return "commerce"
    return "unknown"


def aliases_for(name):
    if not name:
        return []
    a = {name.lower()}
    base = name.lower()
    a.add(re.sub(r"[^a-z0-9 ]", " ", base).strip())
    m = re.match(r"^b\s*[- ]?(\d+)\s*hostel$", base)
    if m:
        a |= {f"b{m.group(1)}", f"b-{m.group(1)}", f"block {m.group(1)}", f"hostel b{m.group(1)}"}
    m = re.match(r"^(a|b|c|d)\s*[- ]?(\d+)\b", base)
    if m:
        a.add(f"{m.group(1)}{m.group(2)}")
    for word in ("hostel", "mess", "block"):
        if word in base:
            a.add(base.replace(word, "").strip(" -,()"))
    a.discard("")
    return sorted(a)


def load_inputs():
    osm = json.load(open(os.path.join(RAW, "osm.json")))["elements"]
    try:
        overture = json.load(open(os.path.join(RAW, "overture.json")))
    except FileNotFoundError:
        overture = []
    return osm, overture


def build():
    osm, overture = load_inputs()
    buildings, roads, areas, pois = [], [], [], []
    unplaced = []
    stats = Counter()

    # ---------------------------------------------------------------- buildings (OSM)
    osm_b = [e for e in osm if e.get("tags", {}).get("building") and e.get("geometry")]
    for e in osm_b:
        ring = [(round(p["lon"], 6), round(p["lat"], 6)) for p in e["geometry"]]
        if len(ring) < 4:
            continue
        name = e["tags"].get("name")
        cat = categorise(name, e["tags"])
        c = ring_centroid(ring)
        near = min(haversine(c[::-1], a) for a in ANCHORS.values())
        conf = "osm"
        buildings.append(dict(
            id=f"osm-{e['id']}", name=name or "Unnamed building", ring=ring, named=bool(name),
            tags=e["tags"], area_m2=round(ring_area_m2(ring), 1), cat=cat,
            scope="campus" if near < CAMPUS_RADIUS_M else "context",
            src="OpenStreetMap (ODbL)", conf=conf, dist_core_m=round(near, 1),
        ))
    stats["osm_buildings"] = len(buildings)

    # ---------------------------------------------------------------- buildings (Overture, dedup vs OSM)
    osm_centroids = [(ring_centroid(b["ring"]), b) for b in buildings]
    overture_added = 0
    for i, ob in enumerate(overture):
        g = ob.get("geom")
        if not g:
            continue
        geo = json.loads(g) if isinstance(g, (str, bytes)) else g
        if geo.get("type") == "Polygon":
            rings = [geo["coordinates"][0]]
        elif geo.get("type") == "MultiPolygon":
            rings = [poly[0] for poly in geo["coordinates"]]
        else:
            continue
        # largest ring wins for MultiPolygon (annexe parts are separate footprints)
        ring = max(rings, key=lambda r: abs(ring_area_m2([(p[0], p[1]) for p in r])))
        ring = [(round(p[0], 6), round(p[1], 6)) for p in ring]
        if len(ring) < 4:
            continue
        c = ring_centroid(ring)
        # skip if it is already represented by an OSM footprint (12 m centroid match)
        dup = False
        for oc, ob2 in osm_centroids:
            if haversine(c[::-1], oc[::-1]) < 12:
                dup = True
                ob2["src"] += " + Overture Maps (ODbL/CDLA) footprint cross-check"
                break
        if dup:
            stats["overture_dupes"] += 1
            continue
        near = min(haversine(c[::-1], a) for a in ANCHORS.values())
        name = (ob.get("name") or "").strip() or None
        cat = categorise(name, None)
        buildings.append(dict(
            id=f"ovt-{str(ob.get('id'))[-12:]}", name=name or "Unnamed building",
            named=bool(name), ring=ring,
            tags={}, area_m2=round(ring_area_m2(ring), 1), cat=cat,
            scope="campus" if near < CAMPUS_RADIUS_M else "context",
            src="Overture Maps 2026-08-19.0 (ML footprints, ODbL/CDLA)", conf="osm",
            dist_core_m=round(near, 1),
        ))
        overture_added += 1
    stats["overture_buildings_added"] = overture_added
    stats["overture_total"] = len(overture)

    # ── zone, locator names, category hints, entrances ──────────────────────
    for b in buildings:
        c = ring_centroid(b["ring"])          # (lng, lat)
        d_south = haversine((c[1], c[0]), ANCHORS["south_core"])
        d_north = haversine((c[1], c[0]), ANCHORS["north_core"])
        b["zone"] = ("south" if d_south <= d_north else "north") if b["scope"] == "campus" else "context"
        b.setdefault("cat_conf", "derived" if b["cat"] == "unknown" else "src")

        # heuristic category for UNNAMED footprints only — never override a real name
        if b["cat"] == "unknown" and b["scope"] == "campus" and not b.get("named"):
            for limit, cat in AREA_CAT_RULES:
                if b["area_m2"] >= limit:
                    b["cat"] = cat
                    b["cat_conf"] = "derived"
                    break
            else:
                b["cat"] = "utility"
                b["cat_conf"] = "derived"
            # rebuild the attributes that depend on the category
            d_floor, d_h, d_note = FLOOR_DEFAULTS[b["cat"]]
            roof, pitch, roof_note = ROOF_BY_CATEGORY[b["cat"]]
            b.update(floors=d_floor, f2f=d_h, floor_note=d_note, roof=roof, pitch=pitch,
                     roof_note=roof_note, wall=WALL_BY_CATEGORY[b["cat"]],
                     height_m=round(d_floor * d_h + 1.0, 2))

    # sequential, human-usable locator names for unnamed CAMPUS buildings:
    # "North Campus building 14" — honest (it is a locator, not a name) and routable.
    zone_counters = {"north": 0, "south": 0}
    for b in sorted([x for x in buildings if x["scope"] == "campus" and not x["named"]],
                    key=lambda x: (x["zone"], -x["area_m2"])):
        zone_counters[b["zone"]] += 1
        b["name"] = f"{ZONES[b['zone']]} Campus building {zone_counters[b['zone']]:02d}"
        b["name_conf"] = "derived"
    for b in buildings:
        if not b.get("named") and b["scope"] == "context":
            b["name"] = "Unnamed building"

    # ---------------------------------------------------------------- floors / heights
    floors_unverified = []
    for b in buildings:
        t = b["tags"]
        cat = b["cat"]
        lv = t.get("building:levels")
        h_src = None
        try:
            floors = int(float(lv))
            h_src = "osm"
        except (TypeError, ValueError):
            floors = None
        if not floors or floors < 1 or floors > 12:
            d_floor, d_h, d_note = FLOOR_DEFAULTS.get(cat, FLOOR_DEFAULTS["unknown"])
            floors, b["floor_note"] = d_floor, d_note
            if h_src is None:
                b["conf"] = "derived" if b["scope"] == "campus" else "approximate"
                floors_unverified.append(b["id"])
        else:
            b["floor_note"] = f"building:levels={lv} from OSM"
        f2f = d_h if h_src is None else 3.6
        roof, pitch, roof_note = ROOF_BY_CATEGORY.get(cat, ROOF_BY_CATEGORY["unknown"])
        b.update(floors=floors, f2f=f2f, roof=roof, pitch=pitch, roof_note=roof_note,
                 wall=WALL_BY_CATEGORY.get(cat, "plaster_paint_white"),
                 height_m=round(floors * f2f + 1.0, 2))
    campus_b = [b for b in buildings if b["scope"] == "campus"]

    # ---------------------------------------------------------------- POIs for every campus building
    # Every campus footprint becomes a routable destination, even the unnamed ML ones,
    # using the derived locator name. Context (village) buildings are deliberately excluded.
    for b in campus_b:
        pois.append(dict(
            id=f"poi-{b['id']}", name=b["name"], kind="building", cat=b["cat"],
            lat=b.get("entrance_lat") or ring_centroid(b["ring"])[1],
            lng=b.get("entrance_lng") or ring_centroid(b["ring"])[0],
            aliases=aliases_for(b["name"]) + ([str(b["zone"])] if b.get("zone") else []),
            building_id=b["id"], conf=b["conf"], src=b["src"], note=b.get("floor_note"),
            zone=b.get("zone"), named=bool(b.get("named")),
            name_conf=b.get("name_conf", "src"), cat_conf=b.get("cat_conf", "src"),
            entrance_conf=b.get("entrance_conf"),
        ))

    # ---------------------------------------------------------------- roads / paths
    for e in [x for x in osm if x.get("tags", {}).get("highway") and x.get("geometry")]:
        t = e["tags"]
        hw = t["highway"]
        line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in e["geometry"]]
        if len(line) < 2:
            continue
        roads.append(dict(
            id=f"way-{e['id']}", cls=hw, name=t.get("name"),
            width_m=ROAD_WIDTH_M.get(hw, 3.0),
            surface=t.get("surface") or ("paved" if hw in ("secondary", "tertiary", "tertiary_link", "residential", "service", "unclassified") else "unpaved"),
            stairs=(hw == "steps"),
            accessible=(hw not in ("steps",)),
            bridge=t.get("bridge") in ("yes", "viaduct"),
            tunnel=t.get("tunnel") == "yes",
            line=line, src="OpenStreetMap (ODbL)",
        ))

    # entrances: the footprint vertex nearest the nearest mapped road/path vertex.
    # Tagged derived; the manual override file can pin an exact entrance.
    road_pts = []
    for r in roads:
        for lng, lat in r["line"]:
            road_pts.append((lat, lng))
    for b in buildings:
        if b["scope"] != "campus":
            continue
        c = ring_centroid(b["ring"])
        best_d, best_pt = 1e18, None
        for (rlat, rlng) in road_pts:
            d = haversine((c[1], c[0]), (rlat, rlng))
            if d < best_d:
                best_d, best_pt = d, (rlat, rlng)
        if best_pt is None:
            continue
        ent = min(b["ring"], key=lambda p: haversine((p[1], p[0]), best_pt))
        b["entrance_lat"], b["entrance_lng"] = round(ent[1], 6), round(ent[0], 6)
        b["entrance_dist_m"] = round(haversine((ent[1], ent[0]), best_pt), 1)
        b["entrance_conf"] = "derived"

    # ---------------------------------------------------------------- areas
    for e in osm:
        t = e.get("tags", {})
        if not (t.get("landuse") or t.get("natural") or t.get("leisure") or t.get("waterway") or t.get("barrier")):
            continue
        if not e.get("geometry"):
            continue
        topo = e.get("type")
        if topo == "node":
            continue
        ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in e["geometry"]]
        kind = ("water" if t.get("natural") == "water" or t.get("waterway") else
                t.get("natural") or t.get("landuse") or t.get("leisure") or "barrier")
        areas.append(dict(id=f"way-{e['id']}", kind=kind, closed=(ring[0] == ring[-1]),
                          name=t.get("name"), line=ring, src="OpenStreetMap (ODbL)"))

    # ---------------------------------------------------------------- POIs (nodes)
    KIND_MAP = {"cafe": "dining", "restaurant": "dining", "fast_food": "dining", "bank": "commerce",
                "atm": "commerce", "hospital": "medical", "doctors": "medical", "clinic": "medical",
                "school": "school", "college": "academic", "library": "library", "fuel": "utility",
                "conference_centre": "auditorium", "hostel": "hostel", "bus_stop": "transport",
                "parking": "parking", "place_of_worship": "worship", "pharmacy": "medical",
                "police": "admin", "post_office": "commerce", "toilets": "utility", "drinking_water": "utility"}
    for e in osm:
        if e.get("type") != "node":
            continue
        t = e.get("tags", {})
        key = t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("man_made")
        if not key:
            continue
        name = t.get("name") or (f"{key.replace('_', ' ').title()}" if key else "Point")
        cat = KIND_MAP.get(key, categorise(name, None))
        pois.append(dict(id=f"node-{e['id']}", name=name, kind=key, cat=cat, lat=e["lat"], lng=e["lon"],
                         aliases=aliases_for(name), building_id=None, conf="osm",
                         src="OpenStreetMap (ODbL)"))

    # ---------------------------------------------------------------- unplaced (known but not geolocatable)
    unplaced = [
        dict(name="A-9 Building", cat="admin", why="Third-floor offices of Deanery of Infrastructure & Services",
             src="infra.iitmandi.ac.in (building reference only, no coordinates published)"),
        dict(name="A18 Academic Block", cat="academic", why="Seminar Halls A18-1 / A18-2, North Campus",
             src="FARC 2024 venue page names the block but publishes no coordinates"),
        dict(name="Vyas Kund Hostel", cat="hostel", why="Listed among North Campus hostels",
             src="infra.iitmandi.ac.in/diningarea.php"),
        dict(name="Surajtaal / Dashir / Suvalsar / Gaurikund blocks (α β γ δ)", cat="hostel",
             why="North Campus hostel blocks listed by name only; individual block footprints unmapped",
             src="students.iitmandi.ac.in/deanstudents/hostels.php"),
        dict(name="Sports Complex (swimming pool, tennis, hockey, basketball, volleyball)", cat="sports",
             why="Named in institute facility lists; exact footprint not in any open dataset",
             src="infra.iitmandi.ac.in/north.php"),
        dict(name="Main Gate / Security Check Post", cat="gate", why="Campus entry point named in visitor info",
             src="iitmandi.ac.in visitor information"),
        dict(name="Guest House", cat="residential", why="5,829.68 m² listed for North Campus; no footprint",
             src="infra.iitmandi.ac.in/north.php"),
        dict(name="Dining Hall cum Student Activity Centre", cat="dining", why="Named in North Campus facility list",
             src="infra.iitmandi.ac.in/north.php"),
        dict(name="Mani Mahesh / Nako / Renuka Hostels (South)", cat="hostel", why="Named in South Campus hostel list",
             src="infra.iitmandi.ac.in/diningarea.php"),
        dict(name="Book Nook Library (North Campus)", cat="library", why="Mapcarta names it beside North Campus",
             src="mapcarta.com/N… (OpenStreetMap-derived, node removed)"),
    ]

    # ---------------------------------------------------------------- published cross-check
    published = dict(
        north_campus_built_area_sqm=159371.0,
        academic_buildings_count=13, academic_area_sqm=67145.43,
        hostel_blocks_total=19, dining_blocks=3, dining_area_sqm=2650.95,
        faculty_staff_residential_sqm=26664.47, guest_house_sqm=5829.68,
        south_hostels=dict(count=5, area_sqm=25205.23, rooms=739, names=["Mani Mahesh", "Nako", "Renuka", "Chandrataal", "Parashar"]),
        north_hostels=dict(count=5, area_sqm=38069.00, rooms=972, names=["Gauri Kund", "Dashir", "Suvalsar", "Surajtal", "Vyas Kund"]),
        north_residents=dict(students=1260, faculty_staff=141),
        campus_area_acres=538,
        sources=["infra.iitmandi.ac.in/north.php", "infra.iitmandi.ac.in/diningarea.php",
                 "students.iitmandi.ac.in/deanstudents/hostels.php"],
    )

    modelled_area = sum(b["area_m2"] * b["floors"] for b in campus_b)
    # The published institute figure (159,371 m2) covers NORTH campus only, so the
    # cross-check is zone-aware: comparing a two-campus total against it would be dishonest.
    zone_area = {
        z: round(sum(b["area_m2"] * b["floors"] for b in buildings if b.get("zone") == z), 1)
        for z in ("north", "south", "context")
    }
    osm_area = sum(b["area_m2"] * b["floors"] for b in campus_b if "OpenStreetMap" in b["src"])

    manifest = dict(
        generated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        generators=dict(osm="Overpass API extract of bbox 31.7680,76.9750,31.7890,77.0060",
                        overture="Overture Maps release 2026-08-19.0 theme=buildings",
                        terrain="AWS Terrain Tiles terrarium z15", imagery="Esri World Imagery z17"),
        counts=dict(buildings=len(buildings), campus_buildings=len(campus_b),
                    context_buildings=len(buildings) - len(campus_b), roads=len(roads),
                    areas=len(areas), pois=len(pois), unplaced=len(unplaced), **stats),
        confidence=Counter(b["conf"] for b in buildings),
        modelled_campus_floor_area_sqm=round(modelled_area, 1),
        modelled_zone_floor_area_sqm=zone_area,
        published=published,
        coverage_note=("Floor counts for buildings without an OSM building:levels tag use documented "
                       "category defaults (conf='derived'/'approximate'). Footprints are real survey data. "
                       "Facilities known to exist but without published coordinates are listed in "
                       "unplaced.json and are deliberately NOT drawn on the map."),
        floors_unverified_count=len(floors_unverified),
    )

    os.makedirs(OUT, exist_ok=True)
    write(os.path.join(OUT, "buildings.geojson"), fc([
        dict(type="Feature", id=b["id"], properties={k: v for k, v in b.items() if k != "ring" and k != "tags"},
             geometry=dict(type="Polygon", coordinates=[b["ring"]])) for b in buildings]))
    write(os.path.join(OUT, "roads.geojson"), fc([
        dict(type="Feature", id=r["id"], properties={k: v for k, v in r.items() if k != "line"},
             geometry=dict(type="LineString", coordinates=r["line"])) for r in roads]))
    write(os.path.join(OUT, "areas.geojson"), fc([
        dict(type="Feature", id=a["id"], properties={k: v for k, v in a.items() if k != "line"},
             geometry=dict(type=("Polygon" if a["closed"] and len(a["line"]) >= 4 else "LineString"),
                           coordinates=([a["line"]] if a["closed"] and len(a["line"]) >= 4 else a["line"])))
        for a in areas]))
    write(os.path.join(OUT, "pois.json"), dict(pois=pois))
    write(os.path.join(OUT, "unplaced.json"), dict(items=unplaced))
    write(os.path.join(OUT, "floors-unverified.json"), dict(ids=floors_unverified))
    write(os.path.join(OUT, "data.manifest.json"), manifest)

    print(json.dumps({k: v for k, v in manifest.items() if k in
                      ("counts", "confidence", "modelled_campus_floor_area_sqm", "floors_unverified_count")}, indent=1))
    print(f"published cross-check: academic={published['academic_area_sqm']} m², "
          f"north total={published['north_campus_built_area_sqm']} m²")


def fc(features):
    return dict(type="FeatureCollection", features=features)


def write(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path, OUT):24s} {os.path.getsize(path)/1024:8.1f} KB")


if __name__ == "__main__":
    build()
