
---

## v3.3 — "IMAGE-TRUE MASSING" (2026-10-01) — footprints moved onto the HD imagery

Direct response to the annotated Auditorium/Academic screenshots: footprints sat
~5–15 m off the structures. Now that z18 imagery exists (0.51 m/px), the tool ran a
**measured correction**, not a visual guess.

### What the pipeline did
1. **Per-building FFT edge-correlation** of footprint boundaries against the HD ortho:
   normalised-dilation score, two-pass search (≤ 10 m coarse + ≤ 4 m refine).
2. **Strict acceptance** — nobody gets moved on weak evidence: ncc₂ ≥ 0.34,
   improvement ≥ 1.7×, 1.5 m ≤ shift ≤ 13 m, neighbour-hop guard (a shift may never
   start wrapping a neighbour's centroid — rejected 21 borderline/geometrically
   ambiguous cases like trees-only roofs).
3. **15 footprints moved** onto their structures (`docs/ALIGN_REPORT.md` lists every
   id, shift vector, and before/after correlation score). Written as ordinary
   `manual/overrides.json` ring overrides with provenance `verifiedBy: v3.3-imgcorr`,
   so Revert/undo/export all work exactly like a human edit. Review crops were
   human-checked one by one before committing (screenshots on file).
4. What correlation CANNOT fix is SHAPE (e.g. the Academic Block courtyard rectangle
   is longer than the roof line) — that stays honest manual work via Align/Reshape,
   now against imagery 2× sharper than before, plus the v3.2 campus-wide datum slider
   for systematic slides.

### Gates
`tsc` clean · `vitest` **82/82 (18 suites)** · `vite build` green · footprint audit:
overlap count unchanged after the 15 moves (3 pre-existing, no new) ·
Playwright 0 console errors.


---

## v3.2 — "HD GROUND TRUTH" (2026-10-01) — sharp basemap + navigation confirmation

Executed per `docs/ULTRA_V32_PROMPT.md` against the field report (circled screenshots).

1. **HD base imagery.** Re-baked the orthomosaic at **z18: 5,778×4,605 px, 0.51 m/px**
   (2× sharper than z17; 456 Esri World Imagery tiles stitched). Tracing roads and
   footprints now has a genuinely sharp base to sit on. Same BBOX → terrain and ortho
   stay co-registered; `campus-z17.jpg` kept as fallback.
2. **Navigation confirmation for drawn paths.** Save a road and the Edit → Routes row
   shows **“✓ in navigation (joined at start/end)”** or **“✗ not routable — extend an
   end onto a road or a door”** in real time (live from the admission engine).
3. **DOOR workflow, completed.** *Set entrance on road* (v3.1) + v3.2: while drawing a
   road, the START click and the finishing double-click **snap to a hand-set door
   within 35 m when the door is the closer join** — roads end AT the door, visibly,
   and routes terminate there. Door dots + dashed links render on the map.
4. **Campus datum correction** (the Auditorium/dome misregistration): Edit → Routes →
   *Campus alignment* — one-click arrows slide **all generated** roads+buildings by
   0.3/1 m (chip shows current shift; Reset; undo/export included). Hand-drawn content
   and per-building reshapes never slide (they're already imagery-true).
5. **Old-path removal** (recap): Manage existing roads → Hide → draw replacement;
   restore any time. Both baked and session flows carry it.
6. **Fragment hygiene.** *Dissolve fragment* button hides nuisance cells reversibly;
   3D-completeness audit proves every visible campus footprint renders triangles
   (`tests/plinth.test.ts`).
7. **Dome crossing, source-fixed.** way-762330812's line is now physically trimmed at
   the Oak Mess (osm-762330814) wall in `manual/road_fixes.json` (0.15 m gap) — the
   map no longer DRAWS a road through the mess and the graph clamp re-verifies zero
   crossings at every load.
8. **Roads-only is vivid**: brighter grey table (#6d7d77), punchier network red,
   thicker network width.

### Gates
`tsc` clean · `vitest` **82/82 (18 suites; +datum ×3, +plinth audit, existing roadwork
×6)** · `vite build` green · Playwright smoke 0 console errors · HD chip reads
"5,778×4,605 px @ ~0.51 m/px".


---

## v3.1 — "ROAD WORKBENCH" (2026-09-30) — roads are now clay, not glass

Direct response to the field report: *"Fix-the-road button doesn't work, new roads
trace onto old roads, I can't delete part of a road and redraw it, navigation must
know which road terminates at which building, and I want to mould roads like clay."*

### What changed (four pieces, each blunt and testable)
1. **Road pick tolerance.** "Fix an existing road" missed because the click target was
   a 2-3 px line. The pick now queries a **±9 px box and takes the nearest road
   geometrically** — plus you can skip the panel entirely: **right-click any road
   line in edit mode jumps straight into fixing it.**
2. **New roads no longer get eaten by old roads.** Mid-waypoint snapping is GONE:
   only the START click (60 m) and the double-click END seal onto an existing line.
   Draw a parallel road 5 m from an old one and it stays exactly where you drew it.
3. **Delete → redraw workflow.** Edit → Routes → *Manage existing roads* lists every
   road with **Hide**: the road leaves the map and the network, the connectivity
   baseline is recomputed against what you kept, and it stays listed under *Hidden
   roads* with one-click **Restore** until you draw its replacement. Hides ride in
   the session file AND `manual/road_fixes.json` (`hidden:` key) so they survive
   export permanently — never silent.
4. **Roads mould like clay.** While fixing a road: drag amber handles (was there),
   **← → ↑ ↓ moves the WHOLE line 0.3 m (Shift = 1 m), Enter commits** — plus
   click-the-line to insert a vertex, right-click a handle to delete (was there).
   The sticky mode pill always says which tool owns the map.

### Building door nodes — "how does navigation know the road terminates HERE?"
The honest answer: the map already had derived `entrance_lat/lng` per building and routes
prefer them; v3.1 makes doors **hand-settable**. Edit → building → **Set entrance on road**
→ click the road (≤ 60 m): the door snaps ONTO the road line as a real network-touched
point (`node-end-node`; routes walk the road to the very door), a teal **door dot with a
dashed link** renders on the map, and the door is stored in the normal building-override
pipeline — so it exports, imports, merges, and "Revert" undoes it. Clear door resets to
centroid routing.

### Gates
`tsc` clean · `vitest` **78/78 (15 suites; new roadwork × 6: delete/adopt, mould,
door-contract)** · `vite build` green · Playwright smoke **0 console errors** including
the Manage-existing-roads → Fix shape → arrows → Enter → "shape committed" round trip
(screenshot `shots/v31-roadfix.png`).


---

## v3.0 — "THE TRUTHFUL ROUTER" (2026-09-30) — ULTRA remediation shipped

Hands section superseding v2.2. Everything below IS LIVE in this release and covered
by automated tests where a test can know the truth without eyes.

### The killer bug that is dead now
* **Every hand-drawn road since v1.8 was silently rejected.** The merge gate required
  connectivity ≥ 0.999 while the campus base network measures 0.8846 — hand roads
  could never cross it. Replaced by **per-road admission** (`mergeRoadSessionChecked`,
  `src/data/roadEdits.ts`): each drawn road projects its ends onto the nearest road
  (≤ 60 m), the target road is SPLIT at the join so the graph node coincides exactly,
  dead-end spurs are legal topology, and only roads touching NOTHING are rejected —
  loudly: amber chip in Edit → Routes with measured gap, a **Fix now** button that
  re-seeds tracing from the failing end, a Route panel banner, and a warn toast.
  The merge still rolls back if it would DECREASE connectivity vs the 0.8846 baseline.

### Routing ↔ massing (§1–§2)
* **Graph-time footprint clamp** (`buildOutdoorGraph(…{buildings})`): edges whose
  midpoint sits inside, ends straddle (inside XOR), or segment crosses a campus
  footprint are DROPPED (bridges/tunnels exempt); every drop surfaced in
  `graph.droppedCrossings`. Runtime AND fixtures both clamp; `tests/routeclip.test.ts`
  asserts zero through-building edges remain.
* **Snap assist**: while drawing a route, a dashed amber preview shows the exact join
  point within 60 m; START and double-click END seal onto line-touches, middle
  waypoints only snap within 12 m so drawing alongside a road is not hijacked.

### Picking (§3)
* 3D building pick is **containment-first**: inside the real footprint or ≤ 2.5 m from
  its ring; centroid fallback capped at 50 m (was "220 m nearest" → ~75 % wrong picks).
  Translucent roofs are raycast-live (canopies no longer swallow clicks).

### Manual buildings (§4–§5)
* Opacity floor 0.15 (0-alpha buildings used to render INVISIBLE while still picking).
* Draft guard: starting a new trace with points on the ground asks for confirmation.
* **Align-to-imagery mode** (the B19 workflow, made first-class): Edit → building →
  Align to imagery → arrows nudge 0.3 m (Shift 1 m), Q/E rotate 0.5° (Shift 2°),
  Enter saves, Esc cancels; preview = the amber handle-line.
* `tools/footprint-check.mjs` audits: degenerate vertices, duplicated footprints,
  overlaps, size outliers, road×building crossings (`--strict` exits 1).

### UX + keyboard (§7)
One global shortcut layer `src/hooks/useGlobalShortcuts.ts` (inputs always win;
drawing tools lock letters so views can't flip under a trace):

| Key | Does |
|---|---|
| `/` | focus campus search |
| `1` `2` `3` | 3D view · 2D map · indoor viewer |
| `x` `l` `r` | toggle Explore / Layers / Route panels |
| `i` `e` `a` | toggle Indoor / Edit / About panels |
| `v` | roads-only view (grey drawing table now; exit chip at top) |
| `h` | home camera |
| `?` | shortcuts overlay (Esc closes) |
| `Enter` / double-click | finish route (ends snap ≤ 60 m) |
| `Backspace` / `Ctrl+Z` / `Ctrl+Y` | undo vertex · undo op · redo |
| `Q/E` + arrows | Align mode: rotate / nudge footprint |
| `Esc` | cancel active tool (announced on the Edit mode rail) |

Edit panel gained the **mode rail**: exactly one tool is live at a time, shown as a
sticky pill; two tools fighting over a click is structurally impossible.

### Gates
`tsc` clean · `vitest` 72/72 (14 suites incl. new roadsession/routeclip/b19opacity)
· `vite build` green · footprint audit recorded in PR notes.

# MASTER PROMPT — IIT Mandi Campus Navigation System
**Version 2.2 — True-floor corridor routing · Roads-only view · Alternate routes · all earlier versions intact**

## New in v2.2 — navigation that follows REAL paths, not dot-to-dot lines

The user report that drove this version: indoor routing connected labels with straight
lines *through walls*, which destroyed the project's purpose; outdoor navigation needed
road inspection, missing-road drawing had to be understandable, and routes needed
Google-Maps-style alternatives.

### §A Indoor corridor network ("floor roads") — the wall-respecting mechanism
- Every floor gains real **walkable corridors**: in the Digital-floor-map editor, arm
  **"Draw corridor path"**, click along corridors, double-click/Enter to finish, Esc to
  cancel. Clicking near an existing corridor vertex **snaps to it** — that is how branches
  join the main corridor line.
- Room/door labels **attach automatically**: routing projects each label onto the nearest
  corridor point (the "join point" the user asked for), walks along corridor edges, and
  steps off at the destination's join point. The drawn path can never cross a wall as
  long as corridors are drawn along walkable space.
- Floors **without** corridors keep the legacy manual label-connection graph; floors
  with corridors use corridors (connections still name stair/lift hops between floors).
- Corridors persist to localStorage, ride inside floor bundles (base64 images included)
  and merge per-floor with teammates' work like everything indoor.

### §B Roads-only inspection switch (outdoor)
- One toggle in the Layers panel — **"Roads only"** — hides buildings, trees, imagery,
  labels and POI in BOTH 2D and 3D and leaves only the road/footpath/stairs network at
  full strength, so the team can see every mapped road, spot gaps and verify the editor's
  drawn roads landed. Toggle off → full scene returns exactly as before.

### §C Alternate routes, Google-Maps style
- `routeAlternatives()` (edge-penalty k-shortest on the A* graph) returns up to 3
  meaningfully different paths: identical-shape duplicates are rejected.
- The Route panel lists them as chips — **Fastest** highlighted, the rest "±N% longer" in
  a dull colour. Non-active alternates draw as **dull grey-blue lines UNDER the red active
  route** in 2D and 3D; clicking a chip or a dull line swaps it to active.
- Each chip shows distance + walk time (Naismith), so choices are "feasibility" choices,
  exactly as on Google Maps.

## New in v2.1 — complete sync, sub-floor splits, LLM-feature merging
- **Floor bundles (images included)**: each floor's editor exports a bundle JSON containing floor metadata, labels, connections AND the uploaded plan images (base64). Importing on another laptop stores images into IndexedDB and merges **per floor label** — new labels adopted whole, same labels fill gaps only (integrator's items never replaced), nothing-new imports are reported.
- **Building rename propagation**: renaming a campus building (editor or merged session) instantly renames every local indoor copy + its floor listings and future exports (`syncBuildingNames` runs whenever campus names change).
- **3D opacity stuck bug FIXED**: translucent buildings previously rendered at one hardcoded opacity (0.55) — now every translucent triangle carries its building's exact editor opacity as per-vertex alpha; 0.2 and 0.95 are visually distinct (regression test included).
- **Code-level team merging**: teammates can hand the integrator zips modified by different LLMs — `tools/team-merge.mjs --base <v2.0> --contrib x=<zip> ... --out merged` auto-applies single-author changes, lists multi-author files with each candidate's path/hash, and never silently drops deletions (report in `TEAM_MERGE_REPORT.md`).
- **v2.0 BACKUP discipline**: a sealed pre-2.1 backup zip is kept as a restore point; restore by extracting to a separate folder — it is never a merge input.
- Author/zone names are set once (Edit tab Teamwork section) and shared with floor bundles.

## v2.0 — group work support (docs/TEAM_WORKFLOW.md)
- **Session files**: one JSON carries a member's entire editing session (buildings, labels, new/fixed routes) with author + zone stamps.
- **Export my session / Import teammate's session** in the Edit panel, multi-file import.
- **Safe auto-merge**: disjoint work merges cleanly; same-building conflicts keep the integrator's values for contested fields (untouched fields still merge) and are listed — nothing is ever silently overwritten. Every import is one Ctrl+Z.
- **6-role workflow** documented (2 zone editors, route editor, indoor editor, integrator, release manager/QA) with the daily export→merge→release loop.
- Honest constraint kept: no server = no silent shared writes; per-browser localStorage remains the source of truth between merges.

## Delivered and verified (v1.9, all intact)

### §4 Route Editor + New Route Tool — ✅ SHIPPED
- **Draw a route** (Edit panel → Map view): click = start (green), waypoints (white), double-click / Enter / *Finish* = end (red). Esc cancels, Ctrl+Z removes the last point.
- Endpoints **auto-snap** (≤ 25 m) to the existing network so paths connect; the **route graph rebuilds** immediately and is kept ONLY if the connectivity audit still shows one connected component — otherwise the generated network is rolled back (a bad line can never strand the campus).
- **Fix an existing road**: arm the picker, click any road line → amber vertex handles; drag / click-line-to-insert / right-click-to-delete; Save replaces the road geometry (`roadEdits`), Restore brings the generated line back.
- **Building-crossing guard**: after every route draw, intersections with building footprints are computed and reported by name.
- Storage/exports: `public/data/manual/road_fixes.json` + `roads_manual.json` (empty scaffold files ship in the repo; merged before graph build so routes use them immediately).

### §5 HD basemap for editing — ✅ SHIPPED
- Root blur cause found & fixed: the live Esri HD raster layer was **below** the baked ortho (invisible). Reordered; Edit mode now auto-enables Live imagery at up-to-0.3 m/px with graceful offline fallback to the baked orthomosaic.
- Edit-mode **cursor readout** (lat,lng + zoom, 6 decimals) + existing scale bar give verifiable tracing dimensions.

### §6 3D textures & graphics — ✅ SHIPPED
- Procedural near-white **grain finish** on walls & roofs (multiplied with vertex colors — campus colors stay true), zero geometry risk, cached single 256² canvas.
- **Contact shadows**: one soft radial blob per building grounding it on the terrain (no more floating slabs).
- Both skip automatically on `low` device tiers.

### Editor platform — ✅ SHIPPED
- **Undo/redo history** (60 steps): every saved action — building edits, removes/restores, labels, route draws/fixes, reshapes. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y + panel buttons.
- **Reshape footprint** for ANY building (generated ≡ manual): amber handles, insert/delete, validation (≥3 corners, ≥4 m², self-intersection rejected), saved as an override `ring` — the building rebuilds in 2D + 3D, exportable.
- Double-click inspector (2D + 3D), live-draft slider preview, floors→height canon — all from v1.8, intact.

### Indoor workspace — ✅ SHIPPED
- **Multi-image plan gallery** per floor: multiple uploads, thumbnails, click-to-activate, delete.
- **IndexedDB storage** for image bytes — localStorage keeps metadata only → the quota overflow failure is gone (legacy data-URL fallback in private mode).
- **Zoom / pan / fit** viewport: scroll-wheel zoom around cursor, drag-pan, ± buttons, Fit reset; clicks still place labels exactly.

### §1–§3 (v1.8) — intact
## Verification (v2.2 build)
- `tsc --noEmit`: **0 errors**
- Tests: **62/62 pass** (12 suites incl. corridor wall-respect + alternate-route v2.2 tests)
- Production build ✓ · entry bundle **84.6 KB gzip**
- Headless browser smoke (Playwright, production bundle): **0 console errors**
- Visual proofs: `shots/v22-roadsonly-3d.png` + `shots/v22-roadsonly-2d.png` (network-only view, both renderers), `shots/ab-on/off.png` (opacity override honoured — translucent Academic Block)
- `tools/team-merge.mjs` verified on synthetic two-contributor trees (auto-apply + conflict report exact)

## Quick start
```bash
npm install
npm run dev        # http://localhost:5173  (append ?edit=1 for the editor)
npm run build
npm test           # 62 tests
```
**Group work:** each member works at `?edit=1` in their role (see docs/TEAM_WORKFLOW.md), exports *"Export my session"* (and per-floor **bundles with images** for indoor work) and sends the files to the integrator, who imports them all and exports the final `public/data/manual/` files. For parallel **code** changes: `node tools/team-merge.mjs --base <v2.0> --contrib name=<their.zip> ... --out team-merged` → follow `TEAM_MERGE_REPORT.md`.

---

## v3.4 — IMAGE-TRUE SIZING + BLUE NAV (2026-10-01)

- **Footprint sizes vs HD imagery**: per-building measured (sx,sy) fit against the z18 ortho's Sobel edge field (same 0.51 m/px datum as v3.3). 200 footprints >=150 m² evaluated; bars: final edge >=4x global mean (imagery p90=22; accepted all >=34), improvement >=1.12x, >=3% dimensional change, area 0.70-1.85x guard, neighbour-centroid hop guard. 24 numeric candidates -> every one human-reviewed on red/green review crops -> **9 committed** as `v3.4-imgscale` overrides (4 chained on top of their v3.3 position fixes, provenance preserved in note). 15 rejected: scale cannot fix L-shapes, rotations or multi-mass confusions — those remain per-building Align/Reshape work in-app. Full table: docs/ALIGN_REPORT.md.
- **Navigation route recoloured** (2D + 3D + indoor): Google-Maps style — white casing under a **#1a73e8** blue core (stairs dashed light-blue #8ab4f8; alternatives stay muted grey). Replaces the old red #ff304f/#650d12 everywhere incl. draw-preview, waypoint marker, help copy.
- Gates: tsc clean · **82/82 tests** · build green · footprint audit unchanged (only pre-existing 1 clamped road x building case, 0 new overlaps).

### v3.4.1 patch (2026-10-01)
- Extended image-true sizing to **small structures (50–150 m²)** — 260 footprints evaluated, strict small-target bars (edge ≥36, imp ≥1.15×), all 36 candidates human-reviewed on crops → **15 committed** (`v3.4.1-imgscaleS`, incl. Chandrataal Annexe); 21 rejected (neighbour hops, no visible structure, shed-row ambiguity). Total auto-fitted now: 15 positions (v3.3) + 9 sizes (v3.4) + 15 small sizes (v3.4.1) = **39 imagery-verified overrides**.
- Gates: 82/82 tests · tsc clean · build green · footprint audit unchanged (3 known partial pairs, 1 known clamped road case, 0 new).


---

## v3.5 — PLAZA CLUSTER FIX + 2 MISSING FOOTPRINTS (2026-10-01)

User-supplied annotated 3D screenshot of the amphitheatre plaza (blue: b70/b03-west zone; green: b153-b02 cluster). Worked measured, not eyeballed: targeted ±22px correlation on all 11 zone buildings + crop review -> **6 ring moves committed** (b02 (-19,+7)px onto arc strip, b153 (-23,+8)px, b70 (-14,+10)px manual off tree canopy onto its pale-walled structure, b116/b109/b05 snugs); **5 rejected** with reasons (b03 = multi-part ring needs Reshape-split, b10 twin-structure, b192/b132/b181 hop/no-structure). Digitized **2 genuinely missing footprints** (Amphitheatre NE hall, Amphitheatre N annex B) via the manual-additions layer; 3 further drafts dropped when the containment audit proved existing rings already cover them. Blue Google-Maps nav line (#1a73e8 on white casing) confirmed shipping since v3.4. Gates: 82/82 tests, tsc clean, build green, 0 new overlaps.


---

## v3.6 — MOVABLE BUILDING NODES ("MAP PIN") + OAK MESS FIX (2026-10-01)

User: "Oak Mess not there where I marked — want mechanism to set location of building, the node location." Delivered BOTH:
1. **Mechanism** — new `labelAt` building override ([lng,lat]): one node that drives the building's 2D pin + label, 3D label anchor, search-result point, and default route destination (priority: door > map pin > footprint centre). Edit flow: Edit → building → **"📍 Move map pin (label / search node)"** → click anywhere (free placement, no road snap — it marks identity, doors still belong on roads) → normal override pipeline (undo / export / revert / Apply-to-GeoJSON). "Clear map pin" restores the centroid. Files: overrides schema, mergeEdits (building+POI), loaders (POI sync), Campus3D Labels anchor, RoutePanel destination, editStore (labelArmed/setLabelAt), Map2D click latch, EditPanel buttons.
2. **Preset applied** — Oak Mess (osm-762330814, the round dome hall) node moved ~10 m into the dome body at the user's marked SW side; it was crowding North Campus building 07's label at the dome's north rim.
Gates: tsc clean · 82/82 tests · build green.
