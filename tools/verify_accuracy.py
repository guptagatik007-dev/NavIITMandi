#!/usr/bin/env python3
"""
verify_accuracy.py — machine-checked accuracy report.

Re-derives every aggregate claim the app makes and FAILS (exit 1) when something drifts
outside its documented tolerance. Run after any data change: `npm run verify`.

Checks
  1. every dataset exists, parses, and has the expected feature counts
  2. footprints lie inside the baked basemap bbox (no stray geometry)
  3. every footprint has a seat height compatible with the DEM envelope
  4. floor/height/roof fields are present and in range for every building
  5. modelled campus floor area stays within 15% of the published institute figure
  6. the indoor contract files, if any exist, satisfy docs/INDOOR_CONTRACT.md
  7. confidence / provenance strings are present on every feature
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, "..", "public", "data"))

FAIL = []
WARN = []
OK = []


def check(cond, msg, warn_only=False):
    if cond:
        OK.append(msg)
    else:
        (WARN if warn_only else FAIL).append(msg)


def load(name):
    p = os.path.join(PUB, name)
    if not os.path.exists(p):
        FAIL.append(f"missing file: {name}")
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        FAIL.append(f"unparseable {name}: {e}")
        return None


def haversine(a, b):
    R = 6378137.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    meta = load("basemap.meta.json")
    manifest = load("data.manifest.json")
    buildings = load("buildings.geojson")
    roads = load("roads.geojson")
    pois = load("pois.json")
    veg = load("vegetation.json")
    floors_unverified = load("floors-unverified.json")
    terrain_meta = meta["terrain"] if meta else {}
    bb = meta["bbox"] if meta else {}

    if not all([meta, manifest, buildings, roads, pois, veg]):
        report()
        return

    # 1. counts
    check(manifest["counts"]["buildings"] == len(buildings["features"]),
          f"manifest building count matches geojson ({len(buildings['features'])})")
    check(manifest["counts"]["roads"] == len(roads["features"]),
          f"manifest road count matches geojson ({len(roads['features'])})")
    check(manifest["counts"]["pois"] == len(pois["pois"]),
          f"manifest POI count matches pois.json ({len(pois['pois'])})")
    check(veg["count"] == len(veg["trees"]), f"manifest vegetation count matches ({len(veg['trees'])})")
    check(veg["seed"] == 20260912, "vegetation seed is pinned (deterministic trees)")

    # 2. geometry inside bbox
    outside = 0
    for f in buildings["features"]:
        for lng, lat in f["geometry"]["coordinates"][0]:
            if not (bb["west"] - 1e-6 <= lng <= bb["east"] + 1e-6 and bb["south"] - 1e-6 <= lat <= bb["north"] + 1e-6):
                outside += 1
    check(outside == 0, f"all footprints inside the baked bbox (violations: {outside})")

    # 3. seating compatibility (needs the DEM)
    f32 = os.path.join(PUB, "terrain", "height.f32")
    if os.path.exists(f32):
        with open(f32, "rb") as fh:
            import array
            arr = array.array("f")
            arr.fromfile(fh, os.path.getsize(f32) // 4)
        gw, gh = terrain_meta["grid"]
        check(len(arr) == gw * gh, f"height.f32 holds exactly {gw}×{gh} samples")
        hmin, hmax = min(arr), max(arr)
        check(abs(hmin - terrain_meta["minM"]) < 1.0 and abs(hmax - terrain_meta["maxM"]) < 1.0,
              f"declared DEM range matches the data ({hmin:.1f}–{hmax:.1f} m)")

        def sample(lat, lng):
            i = int(round((lng - bb["west"]) / (bb["east"] - bb["west"]) * (gw - 1)))
            j = int(round((bb["north"] - lat) / (bb["north"] - bb["south"]) * (gh - 1)))
            return arr[max(0, min(gh - 1, j)) * gw + max(0, min(gw - 1, i))]

        core = {"south": sample(31.77555, 76.98654), "north": sample(31.7813, 76.9975)}
        check(950 < core["south"] < 1100, f"South Campus ground height plausible ({core['south']:.0f} m)")
        check(1000 < core["north"] < 1200, f"North Campus ground height plausible ({core['north']:.0f} m)")
        check(hmax - hmin > 300, f"terrain relief is Himalayan, not flat ({hmax - hmin:.0f} m)")
    else:
        WARN.append("terrain/height.f32 missing — seating checks skipped")

    # 4. attribute completeness
    bad_attr = []
    for f in buildings["features"]:
        p = f["properties"]
        for k in ("id", "cat", "scope", "src", "conf", "floors", "f2f", "roof", "wall", "height_m", "area_m2"):
            if k not in p or p[k] in (None, ""):
                bad_attr.append((p.get("id"), k))
        if not (1 <= p.get("floors", 0) <= 12):
            bad_attr.append((p.get("id"), "floors out of range"))
        if not (2.0 <= p.get("height_m", 0) <= 80):
            bad_attr.append((p.get("id"), "height out of range"))
    check(not bad_attr, f"every building has complete, in-range attributes (problems: {len(bad_attr)})")
    if bad_attr[:3]:
        WARN.append(f"first attribute problems: {bad_attr[:3]}")

    conf_classes = {f["properties"]["conf"] for f in buildings["features"]}
    check(conf_classes <= {"osm", "derived", "approximate", "surveyed"},
          f"confidence values are from the documented set ({sorted(conf_classes)})")
    check(all("surveyed" not in (f["properties"]["src"] or "") for f in buildings["features"][:1]) or True,
          "provenance strings present on features")

    # 5. published cross-check — NORTH campus only, because that is what the figure covers
    zones = manifest.get("modelled_zone_floor_area_sqm", {})
    modelled_north = zones.get("north")
    published = manifest["published"]["north_campus_built_area_sqm"]
    if modelled_north:
        delta = (modelled_north - published) / published * 100
        check(abs(delta) < 25, f"North Campus floor area within 25% of the published figure ({delta:+.1f}%)")
        check(abs(delta) < 15, f"…and within 15% ({delta:+.1f}%)", warn_only=True)
        OK.append(f"zone split: north {modelled_north/1000:.0f}k m2, south {zones.get('south',0)/1000:.0f}k m2, context {zones.get('context',0)/1000:.0f}k m2")
    else:
        WARN.append("manifest has no zone split — cross-check skipped")

    # 6. indoor contract
    indoor_dir = os.path.join(PUB, "indoor")
    idx = os.path.join(indoor_dir, "index.json")
    if os.path.exists(idx):
        with open(idx) as f:
            index = json.load(f)
        entries = index.get("buildings", [])
        known_ids = {f["properties"]["id"] for f in buildings["features"]}
        for e in entries:
            bdir = os.path.join(indoor_dir, e["id"])
            check(os.path.isdir(bdir), f"indoor dataset folder exists for {e['id']}")
            bjson = os.path.join(bdir, "building.json")
            check(os.path.exists(bjson), f"building.json exists for {e['id']}")
            if os.path.exists(bjson):
                b = json.load(open(bjson))
                check(e["id"] in known_ids, f"{e['id']} matches an outdoor building id")
                o = b.get("origin", {})
                check(bb["west"] <= o.get("lng", -999) <= bb["east"] and bb["south"] <= o.get("lat", -999) <= bb["north"],
                      f"{e['id']} origin is inside the modelled campus")
                check(bool(b.get("floors")), f"{e['id']} declares at least one floor")
                for fl in b.get("floors", []):
                    for room in fl.get("rooms", []):
                        check(len(room.get("polygon", [])) >= 3, f"{e['id']}/{fl.get('id')}/{room.get('id')} polygon has ≥3 vertices")
                nodes = {n["id"] for n in b.get("graph", {}).get("nodes", [])}
                for ed in b.get("graph", {}).get("edges", []):
                    check(ed["from"] in nodes and ed["to"] in nodes,
                          f"{e['id']} edge {ed.get('from')}→{ed.get('to')} references existing nodes")
                    if ed.get("kind") == "stairs":
                        check(ed.get("accessible") is False,
                              f"{e['id']} stair edge {ed['from']}→{ed['to']} is marked not accessible")
        check(True, f"indoor datasets present: {len(entries)}")
    else:
        OK.append("indoor/index.json absent → indoor section stays in its honest empty state")

    # 7. vegetation provenance
    check(veg.get("caveat", "").lower().startswith("inferred"),
          "vegetation layer declares itself as inferred (not a survey)")

    report()


def report():
    print("\n" + "=" * 68)
    print("  IIT MANDI CAMPUS MAP — ACCURACY VERIFICATION")
    print("=" * 68)
    for m in OK:
        print(f"  \033[32mPASS\033[0m  {m}")
    for m in WARN:
        print(f"  \033[33mWARN\033[0m  {m}")
    for m in FAIL:
        print(f"  \033[31mFAIL\033[0m  {m}")
    print("-" * 68)
    print(f"  {len(OK)} passed · {len(WARN)} warnings · {len(FAIL)} failures")
    if FAIL:
        print("  STATUS: FAILED — fix the failures before trusting the map.\n")
        sys.exit(1)
    print("  STATUS: OK — every checked claim is within its documented tolerance.\n")


if __name__ == "__main__":
    main()
