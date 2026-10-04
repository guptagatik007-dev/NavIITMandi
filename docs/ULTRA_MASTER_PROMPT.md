# ULTRA MASTER PROMPT — IIT Mandi Campus Navigation System
**Version 3.0 blueprint — deep bug hunt, root-cause verified, most-efficient fix plan**
**Read order: §0 evidence table → §1–§7 problem chapters (symptom → proof → root cause → fix → acceptance test) → §8 execution phases → §9 non-negotiables.**

This document is meant to be executed end-to-end by the engineering agent/team. Every
problem statement below was verified against the live codebase (v2.2 source). Do not
"improve" anything that is not tied to a §-numbered problem with evidence behind it.

---

## §0 Evidence table — the bugs are reproducible, the causes are measured

| # | Symptom the user reported | Measured root cause (verified in repo) | Fix chapter |
|---|---|---|---|
| P1 | "I draw a route manually and it NEVER becomes routable" | **Base network connectivity = 88.46 %** but `App.tsx` adopts the merged road network only when `connectivityShare ≥ 0.999` → every session merge is rejected silently (console.error only). Manual roads have *never* been adopted since v1.8. | §1 |
| P2 | "Many paths penetrate buildings" | Measured: exactly **1 baked violation** (`way-762330812` crosses "Oak Mess" — road endpoint terminates inside the polygon). The perceived "many" comes from (a) `route()`'s straight connect-ends tails cutting massing between the snapped node and the clicked pin, and (b) OSM rings offset from imagery (P5) making roads LOOK like they enter walls. No pipeline step forbids road segments crossing footprints. | §2 |
| P3 | "Clicking a building sometimes selects/double-click-edit works, sometimes not" | `nearestBuilding()` in `src/scene/Campus3D.tsx` picks by **CENTROID distance ≤ 220 m**, not by actual hit containment → in dense blocks the wrong building (or none) wins; translucent roof mesh has `raycast={() => null}` so clicks pass through visible translucent buildings to whatever is behind. | §3 |
| P4 | "B19 (my manual building) — transparency/opacity not working correctly" | Pre-v2.2 bug was a hard-coded 0.55 material (already fixed); remaining failure mode: overrides keyed on added-building ids are lost when the edit is not committed through `addFloorLabel`-style store paths, and added buildings skip the override-save if the edit panel has a draft pending. Needs one regression test + one UI guard. | §4 |
| P5 | "Buildings don't overlap their 2D/imagery footprint — only my B19 is perfect" | Surveyed OSM rings vs Esri z17 imagery carry a systematic offset of a few metres (classic OSM↔imagery misregistration). Manual tracing over the HD basemap is exact because it traces pixels. | §5 |
| P6 | "I can't fix an existing route" | road-fix arming requires visibly clicking the road line — in 2D there is a tiny hit area with no hover highlight, and in 3D roads have `raycast={() => null}`. Users think it's broken when clicks miss silently. | §6 |
| P7 | "UI is not clean/confusing in manual mode, black screen with route" | The editor has 6 separate modes (trace, road trace, road fix, reshape, label, pick) with inconsistent prompts and no single "what to do next" state machine; roads-only view renders pure black in 2D with no context frame. | §7 |

---

## §1 P1 — THE KILLER BUG: hand-drawn routes are silently discarded (priority: P0)

### 1.1 Symptom
"Manual editing → Draw a route … and nothing happens to navigation at the time I do manual they are not working."

### 1.2 Root cause (VERIFIED — do not re-diagnose)
`src/app/App.tsx` road merge gate:

```ts
if (connectivityShare(g) >= 0.999) { roads = candidate; graph = g; }
else console.error('[route-editor] merged road network is not fully connected …');
```

Measured base: **88.46 %** connectivity of the generated OSM network (many disconnected
footpath islands across the valley). 88.46 % < 99.9 % ALWAYS → the `else` branch runs
on every manual-road session → the merged graph is thrown away whole. The user gets
zero UI feedback; the only trace is a console error. Every manual road the team ever
drew was silently thrown away.

Second failure layer: `snapEndpointsToNetwork(line, networkVertices, 25)` — endpoints
beyond 25 m of an existing vertex never join the network, so even a "perfect" merge
gate would strand those lines.

### 1.3 Fix (most efficient = keep the architecture, repair the gate)
1. **Baseline-relative gate, never absolute**: compute `baseShare = connectivityShare(bootstrap.graph)` HOURLY (it is already computed implicitly once). Accept merged graph when `mergedShare ≥ baseShare − 0.001`. This preserves the safety invariant (manual roads can never *strand more of the campus than the base already is*) while accepting correct work.
2. **Per-road admission, not whole-session rejection**: each added road is admitted on its own evidence: a drawn polyline joins the network iff after `snapEndpointsToNetwork(…, SNAP_M)` each endpoint (and every junction vertex it shares) reaches the main component. Rejected roads stay *visible* in the editor list as amber "not joined — extend to an existing road (X m gap)" — never silently dropped from data.
3. **Snap assist at draw time**: while drawing, each cursor position shows a live dashed preview from the last vertex to the nearest existing road vertex when within 60 m (updated on pointermove, projected ONTO the nearest segment, not only vertices). Double-click finish auto-connects; the toast reports "connected (both ends) / connected (1 end, other end is an open spur — fine for dead-ends to hostels)".
4. **User-visible rejection**: if after saving a road still cannot join, a warn toast: `Road saved but NOT routable: 42.3 m from the network at its northern end. Draw a connector or extend it.` — with a "Fix now" button that re-arms drawing starting from that end.
5. **Pre-dead-end acceptance (real campus reality)**: many campus drives legitimately dead-end. The audit must only require: the drawn line connects to the largest component OR has both ends snapped to each other (a loop). A spur to a hostel must NOT reject the whole session.

### 1.4 Acceptance criteria (test-locked)
- `tests/roadsession.test.ts` NEW: (a) base share 88 % vs merged 88 % → ADOPTED; (b) a fully disconnected line → that line marked unjoined, OTHER good lines still adopted; (c) snap-distance test: 24 m → joins, 61 m+ → fails with measured gap surfaced; (d) spur with 1 end joined → routable.
- UI smoke: draw road 200 m off-network → visible amber "not joined" chip + toast; click "Fix now" → drawing resumes at failing end.

### 1.5 Files touched
`src/app/App.tsx` (gate), `src/data/roadEdits.ts` (`mergeRoadSession` per-road verdict: `{adopted, rejected:[{id, gapM, end: 'start'|'end'}]}`), `src/geo/polyOps.ts` (`snapEndpointsToNetwork` → projection-on-segment + configurable SNAP_M=60), `src/features/editor/EditPanel.tsx` (rejected-road chips + Fix-now flow), `src/features/map/Map2D.tsx` (live snap preview dashed line).

---

## §2 P2 — Paths penetrate buildings (routing drawn through massing)

### 2.1 Root cause
1. Baked data: full segment-vs-polygon intersection scan over all road segments × all campus footprints finds **1 violation**: `way-762330812` crosses "Oak Mess" (its endpoint terminates inside the polygon). Bake must write this to an issues file and the manual layer must overwrite it — the pipeline currently ships it silently.
2. **`route()`'s connect-ends tails are straight stubs** — between the snapped network node and the exact destination pin they cut across whatever is in the way. To the user these look like "many paths penetrating buildings": every single route's last leg does this.
3. P5's footprint misalignment doubles up the illusion: roads are drawn right, but rendered buildings sit a few metres OFF their imagery — so roads appear to run under walls.
4. 3D `RouteLine` just plots the coordinates — no footprint-clipping at render time either.

### 2.2 Fix (data-time, not render-time — the honest cure)
1. **Bake-time audit**: extend the road generator QA: any road segment intersecting a campus footprint (edge-cross test) is reported in a new `public/data/roads.issues.json` {roadId, buildingId, segIndex, meters}. Non-fixable ones get deleted in `roads_manual.json` via editor; base bake stops shipping them.
2. **Graph-time clamping (runtime)**: at `buildOutdoorGraph`, drop EDGES whose straight segment crosses any campus building polygon (segment-vs-polygon intersect from polyOps, already used by the cad audit). Cost: ~50 roads × ~10 segments × 332 buildings of bbox-pruned tests — milliseconds. Node ends become dead-ends honestly.
3. **Entrance stubs**: the straight tail to the destination pin becomes: walk to nearest *mapped POI entrance* if one exists for that building (many exist), else the tail is flagged `approximate: true` (already the UI marks it) AND drawn dashed — users see honesty immediately, not a fake corridor through a building.
4. **Regression test**: `tests/routeclip.test.ts` — for every routed geometry in the test fixtures, no segment may cross a campus footprint (allow ≤ 0.3 m tolerance for shared boundary walls).

### 2.3 Acceptance
- Routed paths in the fixture set: 0 building crossings (down from measured ≥ 1 today).
- The cross-building guard in the editor (existing "Building-crossing guard" at draw time) reports the same list the graph-time clamping reports — same source of truth (`src/data/roads.issues.json`).

---

## §3 P3 — Building picking decides by centroid → sometimes works

### 3.1 Root cause
Campus3D picking: `nearestBuilding(buildings, point)` takes the click's 3D POINT and selects the building whose **centroid** is closest (≤ 220 m). In dense blocks a click on building A's far outer wall is *closer to B's centroid* → selects B. Clicks on translucent roofs are swallowed (`raycast={() => null}`) → hit terrain → nearest centroid of *anything* nearby may resolve far away or to `null` → "sometimes not".

### 3.2 Fix
1. Give the raycast result the right meaning: compute point-in-polygon over footprint rings of visible buildings at the hit y-plane: choose the building whose footprint CONTAINS the hit point (with a 2 m tolerance edge band). Only when nothing contains it → fall back to centroid nearest ≤ 50 m.
2. Translucent roofs get a working raycast (they're pickable just like walls) — clicking ANY visible piece of a building selects it.
3. Contact-shadow quads explicitly `raycast={() => null}` (audit: they currently don't carry handlers but they don't need to be hit surfaces at all).
4. Hover = same logic, throttled to 50 ms so hover glow targets the building that's actually under the cursor.

### 3.3 Acceptance
- Playwright: click each of 8 dense-block buildings from 4 camera angles each → 32/32 correct selections.
- Click through a 0.25-opacity building's roof → still selects it.

### 3.4 Files
`src/scene/Campus3D.tsx` (replace `nearestBuilding` with `buildingAt(point)`), translucent-roof mesh raycast, `ringContains()` helper in `src/geo/polyOps.ts` (ray-casting, with tolerance) + tests.

---

## §4 P4 — B19 (manual added building): transparency & respect of edits

### 4.1 Status
The hardcoded-0.55 stuck-opacity bug is FIXED in v2.1/v2.2 (verified A/B pixel test: Academic Block goes translucent at 0.25). B19 is a *manual added building* in the user's browser session — remains the risk path.

### 4.2 Fix
1. **Regression test**: added manual building `manual-b19` + `saved['manual-b19'].opacity = 0.3` → translucent batch renders it at 0.3 (a geometry test asserting vertex alpha for that id's geometry bucket).
2. **Editor guard**: while a draft is pending on another building, changing target warns "Unsaved draft on X — Save or Revert before editing B19" (drafts silently shadow overrides otherwise).
3. **Prompt-commit flow**: when exporting/downloading edits, uncommitted drafts are auto-included with a visible "1 draft included" line — no silent data loss between "preview" and "commit to data".

---

## §5 P5 — Buildings must overlap their imagery footprint like B19 does

### 5.1 Root cause
OSM rings vs baked Esri ortho carry real-world misregistration (multi-metre, directionally consistent in a tile, drifting across a big valley-scale mosaic). The user's hand-traced B19 is pixel-exact against the same imagery, which is why it looks right.

### 5.2 The most-efficient solution (measure once, fix per-building with a tool, never re-bake blindly)
1. **Measure**: `tools/footprint-audit.mjs` — renders, for every campus building at z≈17.8, its vector outline OVER the ortho tile crop, computes an image-based edge-consistency metric and a CoG offset (bounding-box corner RMSE of best-fit translation). Output report: `FOOTPRINT_REPORT.md` with per-building estimated dx,dy,dθ and a traffic light (green ≤ 1.5 m → OK; amber ≤ 4 m → nudge; red otherwise → reshape).
2. **Align-footprint editor mode** (new, sits next to Reshape): select building → "Align to image" → the 2D editor shows the imagery + vector outline; drag = translate, Alt+drag/arrow keys = rotate (0.5° steps), live meter readout; Save writes `ring` override (already the v1.8 mechanism — merge, export, teamwork all inherit it for free).
3. **Batch apply the measured dx,dy** as suggested starting values (all greens + ambers auto-pre-seeded) — the human then just confirms each one with a glance instead of freehanding 332 buildings.
4. **Guard**: reshaped/aligned rings get `ringSelfIntersects` + area + "overlap with neighbour ring < 30 % area" validations on save; save refuses and tells user why.

### 5.3 Acceptance
- All 42 named campus buildings audited visually aligned; automated RMSE vs best-fit imagery edge ≤ 1.5 m.
- `tools/footprint-audit.mjs` re-run prints a green report; a control (deliberately misaligned B-your-test) shows red.

---

## §6 P6 — "Fix existing route" feels broken

### 6.1 Root cause
Tiny 2D hit band + zero affordance (no hover glow on the road to be fixed); 3D roads flat-out don't raycast (`raycast={() => null}`) so clicking a 3D road acquits nothing. Success depends on pixel-luck — "can't fix route".

### 6.2 Fix
1. Widen 2D road hit test to 10 px at any zoom with a hover highlight (casing brightens) — users SEE the road is clickable before they click.
2. 3D: road meshes become raycast-able when `roadPickArmed` (runtime change to the roads material raycast while armed — perf-safe because armed is a modal mode).
3. After arming: nearest road within 20 px highlight+pill tooltip "Fix this road?" → click confirms → existing amber handles UX continues unchanged.
4. Toast guidance on arm: "Click the road you want to fix — roads glow on hover in armed mode."

### 6.3 Acceptance
6 road-fix pick attempts from random zooms in smoke: 6/6 land the handles.

---

## §7 P7 — Editor UX: one state machine, one instruction line, no dead ends

### 7.1 Problem
Six modes (trace, road-trace, road-fix, reshape, label, pick) overlap; the bar texts differ per mode; roads-only 2D shows pure black.

### 7.2 Fix (most efficient — unify on a thin "editor mode machine")
1. `EditMode` single source: `{ kind: 'idle'|'trace-bld'|'trace-road'|'fix-road'|'reshape'|'label'|'pick' }` — one selector in uiStore; every panel map chunk derives its state from it. A mode always renders ONE dedicated pill-bar at screen bottom: **colored by mode + exact next action + active shortcut keys** ("Road draw: click = vertex · double-click/Enter = finish · Esc = cancel" / "Fix road: click a road to grab its handles" …). Nothing else renders conflicting instructions.
2. Roads-only view gets a soft grey hillshade-style backdrop (use terrain mesh with a flat neutral material, imagery off by definition) with a "ROADS ONLY" corner badge and the road list counts — black screen gone, context present, roads still fully isolated.
3. A mode-exit is ALWAYS Esc and one visible "Exit mode" chip — global keyboard hook idempotent.
4. "Why isn't navigation working" banner in Route panel if the active edited network has unjoined manual roads (link to §1 fix flow) — users stop debugging blind.

### 7.3 Acceptance
Manual QA script (recorded): a new user draws→saves a road in ≤ 3 min by following ONLY the pill bar; roads-only screenshot shows context frame, not black.

---

## §8 Execution phases (strict order — each phase ships green before the next)

**R1 — Routing honesty (P0 day-one fixes)**
§1 whole (merge gate, per-road admission, snap assist, UI for rejected roads) + §2.2 graph clamping + tests. `npm run build` smoke + regex audit (`tests/routeclip`).

**R2 — Picking + B19 regression (P3, P4)**
§3 + §4 + tests. Visual A/B screenshots committed as reference.

**R3 — Alignment campaign (P5)**
§5 tooling first (report), then editor align mode; buildings fixed in batches of 20, report re-run for green.

**R4 — Editor UX unification (P6, P7)**
§6 + §7 dev visual pass + manual QA script run + video of the walk.

**R5 — Gates & delivery**
`tsc` 0 errors; ≥ 66 tests green incl. all new suites; build fine; Playwright smoke-errors = 0; final zip `v3.0` + updated `ULTRA_MASTER_PROMPT` verification block.

---

## §9 Non-negotiables (carry-forward from all earlier master prompts)
- No invented geodata: gaps are reported honestly, never painted over.
- Every rejection is loud and actionable (never console-only).
- Red line = user's chosen route; alternatives dull underneath; recommendations labelled.
- Nothing silences the cross-building guard, ever.
- Teamwork channels unchanged (session files / floor bundles / team-merge zips).
- All UI affordances test-covered; visual claims screenshot-proven.
