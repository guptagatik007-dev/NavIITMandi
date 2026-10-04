# IIT Mandi Campus Navigator

A 3D digital twin of IIT Mandi's Kamand campus (North + South) with walking directions,
search, printable QR wayfinding sheets, and a local-first indoor floor-navigation workspace
that accepts real plans and requires manual labels/connections instead of inventing rooms.

Built from published spatial data only. **No asset, model, texture, image or code was
taken from `maps.iitmandi.co.in` or any other campus-map project.**

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (binds 0.0.0.0 — dev server, no runtime network needed)
npm run build      # tsc --noEmit && vite build
npm test           # projection, routing and geometry invariants
npm run verify     # machine-checked accuracy report (counts, terrain, cross-checks)
```

The app fetches everything from `public/data/…` with **relative** URLs, so it works behind
any proxy or sub-path with no configuration, and it makes **zero network requests at
runtime**: imagery, terrain and footprints are all baked at build time.

## What is actually in the build

| Feature | State |
|---|---|
| 3D campus scene (terrain + 898 buildings + roads + forest) | **working** |
| Plan / satellite view (MapLibre, offline imagery, 3D extrusions) | **working** |
| Search with aliases and Hinglish terms (`mess`, `padhai`, `A18`) | **working** |
| Walking routes: fastest / step-free / shortest, turn-by-turn, climb profile | **working** |
| Deep links, copy-link, printable QR sheet per named building | **working** |
| Accuracy HUD + satellite alignment overlay (`?debug=align,hud`) | **working** |
| Indoor navigation | **working local-first floor workspace** — upload a real plan, label/connect manually, test a route, export floor JSON; no fabricated rooms |
| Contours, measure tool, hero hand-modelled GLB buildings | **not started** (toggles present, disabled) |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | Typecheck, then production build (heavy engines are code-split) |
| `npm test` | Vitest: projection round-trip, A\* invariants, geometry determinism |
| `npm run bake` | Re-fetch imagery + DEM, rebuild `height.f32` and the typed constants |
| `npm run data` | Rebuild all GeoJSON/JSON from `tools/raw/` (no network) |
| `npm run verify` | Verify counts, bbox containment, terrain plausibility, published cross-check |

## Architecture

```
src/
├─ config/     map.config.ts (anchors, budgets, providers), basemap.generated.ts (baked)
├─ geo/        wgs84 (ENU metres), terrain (DEM sampler), routing (generic A*, profiles)
├─ data/       zod schemas, memoised loaders, fuzzy search index
├─ scene/      buildGeometry (procedural buildings/roads/trees), Campus3D, RouteLine, HUD
├─ features/   map (MapLibre), explore, layers, route, indoor (floor workspace), about, print
├─ app/        App shell, TopBar, CampusContext, ErrorBoundary
└─ ui/         design primitives + icons
tools/         data bakers (Python) — see docs/DATA_SOURCES.md
docs/          ACCURACY_LOG.md · DATA_SOURCES.md · INDOOR_CONTRACT.md · MASTER_PROMPT.md
```

**Performance approach.** Walls, roofs, detail geometry, road ribbons and tree canopies are
merged into a handful of static `BufferGeometry` objects with per-vertex colour; all windows
across the campus are two `InstancedMesh` objects (glass + dark reveal). That keeps a
900-building campus at single-digit draw calls, leaving room for terrain and overlays.
three.js and maplibre-gl are lazy chunks, so the entry bundle stays small.

## Accuracy, in one paragraph

Footprints, roads and POIs are real survey data (OpenStreetMap + Overture Maps). Terrain is
a real DEM with a documented nodata-repair policy. Floor counts, heights, roof forms, facade
materials, window rhythm and cut-bench seating are **derived from documented rules** and
labelled as such everywhere they appear. Vegetation is inferred from imagery. Ten facilities
that certainly exist but have no published coordinates are listed as gaps rather than drawn.
The model's campus floor area lands within 6.3% of the institute's published figure — a
useful sanity check, not a per-building proof. Read `docs/ACCURACY_LOG.md` before trusting a
specific number.

## Legal

* Imagery: © Esri, Maxar, Earthstar Geographics (attribution shown in-app).
* Footprints, roads, POIs: © OpenStreetMap contributors (ODbL) and Overture Maps.
* Terrain: AWS Open Data / Mapzen.
* This is an academic project. Verify anything safety-relevant on site.

## Verification

Seven gates, all runnable. The browser gates are the only ones that can see what a user sees.

```bash
npm run typecheck     # tsc --noEmit, 0 errors
npm test              # vitest — geometry, routing, fog, geo, indoor graph
npm run verify        # tools/verify_accuracy.py — 19 PASS / 0 WARN / 0 FAIL
npm run build         # vite build
npm run shots         # headless Chromium: real camera/input/UI checks, 22 assertions
npm run probe         # real outdoor navigation + footprint-save capability gate
npm run probe:floor   # real edit/remove/restore + floor upload/labels/graph-route gate
```

The browser tools need `npx playwright install chromium` plus the usual Linux browser
libraries. A missing browser must fail loudly; it must never be reported as a passing
render check.

`tools/probe-capabilities.mjs` drives turn-by-turn navigation and the footprint editor
through their real UI. `tools/probe-floor.mjs` additionally proves label edit, building
remove/restore, free-label add/edit/remove, plan upload, manual floor labels, manual graph
connections, red indoor routing and local persistence. Together they earned their place by
catching the worst bugs in the project: `Rail` was declared inside `Shell` (so navigation
never returned a route), the old hide action always saved `hidden:false`, and the first
floor section had no usable capture path.

`tools/shots.mjs` exists because three rounds of defects (a full-viewport overlay that
blocked all input, a fog preset that left 2% visibility, a MapLibre layer that silently
failed to load) were invisible to unit tests and HTTP smoke checks. It asserts, among
other things, that the map is the top-most element at its own centre, that zoom/orbit/pan
and the keyboard measurably move the camera, that each rail panel opens *with its own
content*, that no label rectangles overlap, and that the console stays completely clean.
