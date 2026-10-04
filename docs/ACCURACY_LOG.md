# ACCURACY LOG — IIT Mandi campus twin

Every claim this map makes is listed here with its source, its confidence class and the
tolerance it must meet. **Nothing is silently estimated.** If a number is derived it says so;
if a feature is unverified it is listed as a gap instead of being drawn.

Machine-checked section: `python3 tools/verify_accuracy.py` → **19 PASS · 0 WARN · 0 FAIL**.
Counts are re-derived from `public/data/data.manifest.json` on every run.

---

## 1. Confidence classes used in the data

| Class | Meaning | Where you see it |
|---|---|---|
| `osm` | Human-mapped survey data (OpenStreetMap) | 15 campus buildings with OSM names, roads, paths, stairs |
| `derived` | Computed by this project from a documented rule (category defaults, locators, seating, window rhythm) | Floors, heights, roofs, facade materials, cut-bench platforms, 300 locator names |
| `inferred` | Reconstructed from imagery rather than surveyed | All 2,800 vegetation instances |
| `approximate` | Plausible within a range, not measured | Last leg of a route to an unmapped entrance; "unsurveyed connector" edges |
| `manual` | Entered by a human through the in-app editor | Manual buildings, overrides, manual labels |
| `surveyed` | Measured on site by this project | **none yet** — reserved for GNSS surveys and plan digitisation |

Nothing in the build today claims to be `surveyed`. The accuracy HUD shows the class per feature
and the count of manual corrections.

## 2. Measured vs derived, item by item

| Item | Status | Source / method | Tolerance |
|---|---|---|---|
| Building footprints (**898**) | **measured** | OSM (named/human-mapped) + Overture Maps 2026-08-19.0 ML footprints, deduplicated against OSM | ≤ 1.0 m edge error expected; unverified on site |
| Campus vs context split | **derived** | Campus radius rule → **315 campus** (north 210 / south 105) + 583 context | boundary rule documented in `tools/build_data.py` (ZONES) |
| Baked extent | **measured** | W 76.9750 · S 31.7680 · E 77.0060 · N 31.7890 | contains both campuses |
| Terrain elevation | **measured** | AWS Terrain Tiles (terrarium) z15 → **768 × 614** float32, **954–1661 m** | DEM vertical accuracy ± 5 m |
| Imagery drape | **measured** | Esri World Imagery z17 ≈ 1.015 m/px → ortho **2889 × 2302** | georeferencing error of the imagery itself |
| Road / path centrelines (**50**) | **measured** | OSM (stairs, footways, service, secondary…) | OSM centreline accuracy |
| Road graph | **derived** | 2,219 nodes; snap cell ~27 m; median snap to a campus building **23 m**, max **47 m** | snap > 25 m is labelled in the steps |
| Network components | **derived** | Campus buildings all fall in **one** component; the second component is a detached village trail cluster containing **0** campus buildings | any crossing edge ≤ 30 m is labelled *unsurveyed connector* |
| Road widths | **derived** | class table (`ROAD_WIDTH_M` in `tools/build_data.py`) | ± 1 m — replace with survey |
| Floor counts | **derived** | OSM `building:levels` where present, else category defaults | ± 1 floor |
| Building height | **derived** | `floors × floor-to-floor + 1.0 m parapet` | ± 1.5 m |
| Floor-to-floor height | **derived** | category default (3.2 m hostel → 6.5 m auditorium) | ± 0.3 m |
| Roof form & pitch | **derived** | category table; gable axis from footprint PCA, 0.55 m overhang | ± 5° pitch; form unverified per building |
| Roof caps | **verified** | normal-checked cap per footprint | **0 downward caps** (was 100%); 2,807 upward |
| Wall winding | **verified** | all triangles routed through `triOutward`/`quadOutward` | **0 inward of 8,524** (was 4,304 = 50.5%) |
| Facade material & colour | **derived** | six-material palette (pale plaster, white plaster, stone, stone+glazing, rough stone, industrial metal) | unverified per building |
| Window rhythm | **derived** | 3.3 m bays, 1.5 × 1.5 m openings, 0.9 m sill, recessed 0.12 m — **campus buildings only** | **not a facade survey** |
| Doors & entrances | **derived** | nearest footprint vertex to the nearest road vertex, clamped to the edge → **315 / 315 campus buildings** | position unverified per building |
| Cut-bench platform (seating) | **derived** | `padMSL` = terrain **max** under the footprint; floor at `padMSL`; retaining plinth to `minMSL − 2.5 m`; apron 1.2 m out / 0.45 m down | **16 footprints flagged relief > 12 m** for survey |
| Building names | **mixed** | 15 OSM names + **300 derived locators** (zone-block-index) | 0 junk `"Building N"` names remain |
| Vegetation (2,800) | **inferred** | greenness index on the ortho, **adaptive p42 = 0.277**, seeded sampling, buildings/roads excluded | decoration, not data |
| POIs (**332**) | **mixed** | every campus building is a routable destination (210 north / 105 south) + OSM named facilities | positions as mapped; derived ones inherit footprint accuracy |
| Unplaced facilities | **listed** | 10 known-but-unlocated facilities in `unplaced.json` | listed in the UI, never drawn |
| Manual corrections | **manual** | `public/data/manual/*` + live edit sessions | provenance fields on every entry; bad entries surface as `manualIssues` |
| Indoor data | **no committed plans yet; local upload workspace active** | — | see `INDOOR_CONTRACT.md` and `localStorage['iitm-nav-indoor-v1']` |

## 3. Aggregate cross-check against published institute figures

| Figure | Published (institute) | This model | Delta |
|---|---|---|---|
| North Campus built area | 1,59,371 m² | **1,50,000 m²** (north zone, modelled) | **−5.7%** |
| Campus floor area (all) | — | **1,93,685.6 m²** (north 150k / south 43k / context 99k) | — |
| Academic buildings | 13 nos., 67,145.43 m² | 9 academic-class + 2 lab-class footprints in the campus zones | **partial** — see gap 6 |
| Hostel blocks | 19 | 10 hostel-class footprints | **partial** — see gap 6 |
| Dining blocks | 3 — 2,650.95 m² | 3 dining-class footprints | matches |
| Faculty/staff housing | 26,664.47 m² | not isolated | **gap** |
| Guest house | 5,829.68 m² | not isolated | **gap** |
| Campus area | 538 acres | modelled bbox covering both campuses | partial (landholding not fully modelled) |

A −5.7% delta on an independently derived footprint set is a good signal that the footprint layer
is sound and the category rules are not wildly over- or under-assigning. It is **not** a
per-building verification: it cannot detect a shifted building, only a systematically wrong total.
Rows marked *partial/gap* are outstanding; they are stated here rather than papered over.

## 4. Open verification list

1. **GNSS survey of 20 control buildings** (10 per campus) — corners averaged, residuals logged,
   tolerance table updated. *Deliverable: `docs/survey/*.csv`.*
2. **16 high-relief footprints** (relief > 12 m) — level and verify the cut-platform seating.
   These are listed in the accuracy HUD so they cannot be forgotten.
3. **Measure floor-to-floor height** on A1 / A3 / AMRC and two hostel blocks; compare with the
   3.6 m / 3.2 m defaults.
4. **Roof form audit** — a 45° drone pass gives roof shape and pitch for the 30 largest buildings;
   replace the derived values rather than averaging them.
5. **Entrance positions** — one geotagged photo per main entrance. This is the single biggest win
   for routing quality: it removes every "approximate last leg".
6. **Category reconciliation** — reconcile the academic/hostel classifications against the
   institute's own building list so the count cross-checks (rows marked *partial*) become exact.
7. **Faculty/staff housing and guest house** — isolate these sub-areas so the published areas can
   be checked directly.
8. **Vegetation spot check** — count stems in 10 random 20 × 20 m plots from imagery and compare
   with the 2,800-instance layer. Expect a loose match; it is decoration, not data.

## 5. Browser-verified behaviour (not inferable from the data)

These were measured in a real headless Chromium (`tools/shots.mjs`), because three rounds
of defects were invisible to unit tests and HTTP checks:

| Claim | Measured |
|---|---|
| Wheel zoom moves the camera | 1,392.88 m → 1,326.63 m, and back |
| Left-drag orbits | camera position changes on every drag |
| Right-drag pans | orbit target moves (94.63,−212.93,139.15) → (18.35,−212.93,302.96) |
| Keyboard pans/zooms | target −6.09 → −56.44 m along the pan axis |
| The map is not covered by UI | `elementFromPoint(centre)` is the CANVAS, from the first frame |
| Rail panels open with their own content | Explore / Layers / Route / About, each asserted by a signature string |
| 3D labels | 0 overlapping pairs |
| 2D view | plan view (pitch 0), ≥8 layers, non-blank viewport, 0 overlapping labels |
| Deep link `?b=<id|name>` | flies to the building (target moves; 303 m framing) |
| Console | 0 errors, 0 warnings across a full interaction pass |

Fog is a visibility budget, not a mood: with exponential-squared fog the default preset once
left **2% visibility** at the default framing (a total whiteout). `tests/fog.test.ts` fails if
any preset drops below 80 % at the default view or 85 % at 400 m.

## 6. Capability-verified behaviour (navigation + the manual editor)

`tools/probe-capabilities.mjs` drives the two capabilities that matter most through their
real UI and reads the engine's own verdict via dev-only probes. It found — and now guards
against — the project's most serious defect: RoutePanel wrote `status: 'computing'` into a
store `<Shell>` subscribed to, while `Rail` was declared *inside* `Shell`, so the panel
remounted ~30×/second and its 60 ms compute timer was cancelled before it could fire.
Navigation never produced a route; the effect re-ran 446 times in 15 s with no dependency
change. Hoisting the rail components to module scope made the route resolve in **under
500 ms**.

| Claim | Measured |
|---|---|
| The routing engine resolves | `status: 'ready'`, `ok: true` (was `'computing'` forever) |
| Cross-campus walk | A1 → North Campus building 01 = **2,622 m**, **4,206 s**, **50 steps**, **352 m climb** |
| Short walk | A1 → AMRC = 55 m, 1 min, 1 m climb, flagged *last leg approximate* |
| Route is drawn in 2D | `route` source holds a LineString with >1 coordinate; `route-line` visible |
| Route survives 3D ↔ 2D | distance/time/steps still shown after switching views |
| Manual building round-trip | `?edit=1` → Trace a footprint → 4 corners clicked → Close shape → named → saved → **persisted in `localStorage`** → survives reload → export offered |
| The drawn building is a real feature | stored with its name and a closed ring, and listed in the editor |

## 7. How to re-verify

```bash
npm install --no-audit --no-fund   # node_modules does not persist between sessions
npx tsc --noEmit                   # 0 errors
./node_modules/.bin/vitest run     # 36 tests, incl. geometry, routing and fog audits
python3 tools/verify_accuracy.py   # 19 PASS / 0 WARN / 0 FAIL
npx vite build                     # entry ≤ budget
npm run shots                      # headless Chromium: 22 interaction/UI assertions
npm run probe                      # navigation + manual editor, end to end
```

`tools/verify_accuracy.py` re-derives every number in section 3 and fails loudly if a count, a
bbox or a zone-area delta moves outside its documented tolerance. The geometry audit gates
**0 inward wall triangles** and **0 downward roof caps** at zero tolerance, and the routing audit
gates that every campus building is routable, entrance-mapped, non-junk-named and in the connected
campus network.

## 8. Correction round: editor reliability, red routes and floor navigation

The live correction pass found four user-facing gaps and closed them in place:

| User action | Previous failure | Current behavior / evidence |
|---|---|---|
| Edit a building label | uncontrolled `defaultValue` fields could show the previous target and free labels had no edit path | controlled fields; building label overrides and free labels can be edited/removed; free labels render in 3D and 2D |
| Remove a previous building | the old button patched `hidden: !building` (always false) and hidden items disappeared from the editor | **Remove from map** persists `hidden:true`; the item remains in the Edit list; **Restore building** and Revert work |
| Draw/remove a missing building | the saved drawing path existed, but the correction pass did not prove removal | Trace → Close shape → name → Save → Remove passes in `tools/probe-floor.mjs` |
| Read a navigation route | route was dark/teal | 3D and 2D use dark red casing `#650d12` and red core `#ff304f`; the capability probe checks the MapLibre paint values |

### Floor workspace browser gate

The Indoor tab now accepts a real floor underlay for a selected campus building: PNG/JPG/WEBP,
SVG, PDF or indoor-contract JSON. It stores the floor under `localStorage['iitm-nav-indoor-v1']`,
then supports manual labels (`room`, `door`, `stairs`, `lift`, `exit`, `waypoint`), manual
connections (`walk`, `stairs`, `lift`, `ramp`) and graph routing. A red polyline is drawn only
when the selected points are connected; disconnected points return an honest no-route message.
**Export floor JSON** provides the reviewable handoff into `public/data/indoor/`.

`tools/probe-floor.mjs` drives the real UI and currently proves: building label edit, previous
building remove/restore, free-label add/edit/remove, manual footprint save/remove, floor image
upload, two manual floor labels, a manual edge, indoor route, red route overlay, local
persistence and zero console errors.
