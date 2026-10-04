# DATA SOURCES &amp; LICENCES

Everything the map draws comes from one of the sources below. No asset, code, model or
image was taken from `maps.iitmandi.co.in` or any other campus-map project.

## 1. Spatial base data

| Layer | Source | Endpoint / file | Licence | Refresh |
|---|---|---|---|---|
| Building footprints (human-mapped) | OpenStreetMap | Overpass API, bbox `31.7680,76.9750,31.7890,77.0060` → `tools/raw/osm.json` | ODbL 1.0 | `python3 tools/build_data.py` after re-running the Overpass query |
| Building footprints (ML) | Overture Maps release **2026-08-19.0**, `theme=buildings` | `s3://overturemaps-us-west-2/release/2026-08-19.0/theme=buildings/type=building/*.parquet` via DuckDB → `tools/raw/overture.json` | ODbL 1.0 / CDLA-Permissive 2.0 | `duckdb` query in `docs/` or `tools/` (see §4) |
| Roads, footpaths, steps, barriers, water, landuse | OpenStreetMap | same Overpass extract | ODbL 1.0 | as above |
| Terrain (DEM) | AWS Open Data — Terrain Tiles (terrarium encoding), z15 | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Public domain / Mapzen (CC0-style) | `npm run bake` |
| Satellite imagery | Esri World Imagery (Maxar, Earthstar Geographics) z17 | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Esri Terms of Use — **attribution required and displayed in-app** | `npm run bake` |
| Institute facility figures (cross-check only, never geometry) | `infra.iitmandi.ac.in/north.php`, `infra.iitmandi.ac.in/diningarea.php`, `students.iitmandi.ac.in/deanstudents/hostels.php` | — | Institute website, cited | manual |

## 2. What is baked, and where it lands

```
public/data/
├─ ortho/campus.jpg            Esri World Imagery z17, 2889×2302 @ ~1.015 m/px
├─ terrain/height.f32          768×614 float32 LE heightfield, row 0 = north, 954–1661 m
├─ terrain/preview.json        decimated sample + bbox (tests, quick checks)
├─ basemap.meta.json           extents, encoding, attributions, nodata policy
├─ buildings.geojson           898 features (315 campus: north 210 / south 105; 583 context)
│                              + floors/height_m/roof/wall/conf/src/zone/name_conf/entrance_*
├─ roads.geojson               50 features → routing graph of 2,219 nodes
├─ areas.geojson               6 features (water, landuse, pitches, barriers)
├─ pois.json                   332 routable destinations (210 north / 105 south + named OSM)
├─ vegetation.json             2,800 inferred instances (tagged `inferred`)
├─ unplaced.json               10 known-but-unlocated facilities (never drawn)
├─ data.manifest.json          counts + modelled floor areas (campus 193,685.6 m²)
├─ indoor/index.json           optional committed floor datasets; absent means upload workspace
└─ manual/                     overrides.json · buildings.geojson · labels.json (hand-editable)
├─ floors-unverified.json      ids whose floor count is a documented default
├─ vegetation.json             2,800 inferred trees (seed 20260912)
├─ data.manifest.json          counts, confidence histogram, published cross-check
└─ indoor/                     optional committed floor datasets; browser uploads stay in localStorage until exported
```

`src/config/basemap.generated.ts` is written by `tools/bake_tiles.py` so the app cannot
drift from the baked extent.

## 3. Why "offline first"

The app makes **zero network requests at runtime**. The tile bake is a build step. This is
deliberate:

* the sandboxed preview iframe has no network, and a map that silently goes blank is worse
  than no map;
* on a Himalayan campus, mobile data is patchy — a cached basemap plus flat-coloured
  buildings is a better failure mode than an empty canvas;
* live imagery is available behind the *Live imagery* toggle in Map mode, clearly labelled,
  and only fetches when switched on.

## 4. Reproducing the dataset

```bash
# 1. Overpass extract (network, ~2 s)
curl -X POST --data-urlencode "data@tools/raw/q.overpass" \
     https://overpass-api.de/api/interpreter -o tools/raw/osm.json

# 2. Overture footprints (network, ~90 s, needs duckdb)
pip3 install duckdb
python3 - <<'EOF'
import duckdb
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
con.execute("""
COPY (
  SELECT id, names.primary AS name, height, num_floors, class, subtype,
         ST_AsGeoJSON(geometry) AS geom
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-08-19.0/theme=buildings/type=building/*.parquet')
  WHERE bbox.xmin > 76.9750 AND bbox.xmax < 77.0060
    AND bbox.ymin > 31.7680 AND bbox.ymax < 31.7890
) TO 'tools/raw/overture.json' (FORMAT JSON, ARRAY true);
EOF

# 3. Imagery + DEM bake (network, ~10 s)
npm run bake

# 4. Merge + classify + emit app data (no network)
npm run data

# 5. Vegetation from the ortho (no network)
python3 tools/build_vegetation.py

# 6. Machine-checked accuracy report
npm run verify
```

## 5. Attribution obligations (already shown in-app, in Layers → Data sources and on the print sheet)

* Imagery: **Esri, Maxar, Earthstar Geographics**
* Footprints &amp; roads: **© OpenStreetMap contributors (ODbL)** and **Overture Maps**
* Terrain: **AWS Open Data / Mapzen**
* Facility figures: **IIT Mandi** (infra.iitmandi.ac.in, students.iitmandi.ac.in)

Overture data carries both ODbL and CDLA-Permissive components; the merged file retains a
per-feature `src` string naming both sources, so downstream users can honour each licence.

## 6. Data we would like and do not have

| Wanted | Why it matters | Where it would go |
|---|---|---|
| Drone orthomosaic of both campuses at ≤ 10 cm/px | Replaces the 1 m commercial imagery; everything aligns to it | `public/data/ortho/` |
| Estate-office building list with floor counts and areas | Removes the largest derived class (898 floor counts) | `tools/raw/estate.csv` → `build_data.py` |
| DWG/PDF floor plans for the academic blocks and hostels | Unlocks the entire Indoor section | `public/data/indoor/<buildingId>/` |
| Entrance coordinates (20 buildings) | Removes "approximate last leg" from every route | `tools/raw/entrances.csv` |
| Surveyed spot heights on the main paths | Fixes ramps/steps classification and the accessible profile | `tools/raw/spot_heights.csv` |


## 5. Manual correction layer

The map accepts hand corrections, and they are data like any other — with provenance.

| File | Contents | Precedence |
|---|---|---|
| `manual/overrides.json` | `{ note, buildings: { <id>: {name, cat, floors, height_m, roof, pitch, wall, opacity, seatOffsetM, hidden, modelPath, labelText, labelOffsetM, labelHidden, note, verifiedBy, verifiedOn} } }` | overrides generated data |
| `manual/buildings.geojson` | buildings the user drew in-app (Polygons, `ManualBuildingProps`) | additions on top of generated data |
| `manual/labels.json` | `{ labels: [{ id, text, lat, lng, tier, elevM, offsetM }] }` | manual labels share the automatic style exactly |

Full precedence: **generated < manual additions < manual overrides < live session edits**
(session edits persist in `localStorage['iitm-nav-edits-v1']` and export back into these files).
Hand-drawn buildings run through the same winding, seating, window and label code paths as
generated ones, so they cannot reintroduce the transparency or "sludged" defects.
A malformed entry is skipped and reported in the accuracy HUD (`manualIssues`) — it never crashes
the app and never disappears silently.

## 6. What the browser gate proves

`npm run shots` (`tools/shots.mjs`) drives a real Chromium with WebGL and fails the build on
any console error. It exists because the following all shipped undetected by unit tests:
a full-viewport onboarding overlay that blocked every gesture; a fog preset leaving 2 %
visibility; a MapLibre layer that silently never loaded; and deep-link parameters that the
app's own URL-sync effect erased before they were read. It needs
`npx playwright install chromium`, and it must **fail loudly** if Chromium is unavailable —
an unobserved render claim is not evidence.

## 7. Regenerating everything

```bash
npm install --no-audit --no-fund    # node_modules does not persist between sessions
npm run bake                        # imagery + DEM + generated config (network, ~1 min)
npm run data                        # Overpass + Overture → geojson/json (pipeline order matters)
python3 tools/build_vegetation.py   # adaptive p42 threshold
python3 tools/verify_accuracy.py    # machine-checked report
./node_modules/.bin/vitest run      # geometry + routing audits
npx vite build
```

`tools/bake_tiles.py` requires `HERE` and must keep `__main__` last. The DEM is raw float32 —
never PNG-encode it. Every tool writes to `../public/data`, never to its own folder. See
`docs/ACCURACY_LOG.md` for what each number is allowed to be.
