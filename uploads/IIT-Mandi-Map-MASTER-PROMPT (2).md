# MASTER PROMPT — IIT Mandi Campus Navigation System
### (Outdoor 3D digital twin + Professional manual correction studio + Floor-plan navigation workspace)
**Version 1.5 · supersedes v1.4 · paste this whole file as the first message to Claude Code / Arena Agent Mode.**

Keep it in the repo as `docs/MASTER_PROMPT.md`. It is the **binding spec**: re-read it at the start of every session, and treat Sections 5–11 as the defect contract that v1.0 failed and v1.1 must satisfy.

> **What changed in v1.5.** The next requirement is a **professional manual-correction studio**, not a button that merely stores a polygon. When a generated building is wrong, the user must be able to select it, remove it reversibly, restore it, or redesign its footprint by placing and editing vertices. The visible area must be the **closed polygon under the joined boundary line**, with a live filled preview, first-point snap, undo/redo, vertex drag, insert/delete vertex, self-intersection validation, and a save/cancel workflow. Only the affected building may rebuild on save; pointer movement must not rebuild the whole 898-building scene. The floor section is also upgraded from a single underlay to a professional floor-plan workspace: import multiple floor-plan images/pages, preview them as thumbnails, assign them to a building/floor, zoom/pan/fit the active plan, keep labels and graph overlays tied to the image, and manually build room/door/corridor/stair/lift geometry and routes. The image is evidence, not a room detector. Every new behavior must be browser-tested for correctness, persistence, and no interaction lag. Sections 6, 11, 14, 15, 16, 17 and 18 updated.
>
> **What changed in v1.4.** The next live review found that the correction tools were present but not dependable from the user's point of view: building fields used uncontrolled `defaultValue`s, the Hide action used `!building` (always false while a building was selected), hidden buildings were removed from the runtime list so they could not be restored, and free manual labels had no edit path and were absent from the 2D view. The navigation line was also still rendered with a dark casing/teal core when the user explicitly asked for red. These are now corrected and browser-driven: label override, hide → restore, add/edit/remove free label, draw/save/remove a building, and red route are all tested. Indoor work is no longer only an empty shell: the Indoor tab now accepts a real PNG/JPG/WEBP/SVG/PDF or indoor-contract JSON floor plan for a selected building, persists the local plan, supports manual floor labels and manual graph connections, computes a route only across connected points, draws that route red, and exports floor JSON. No rooms or corridors are invented from pixels. Sections 6, 8, 9, 11, 13, 14, 16, 17 and 18 updated.
>
> A second browser pass drove the two capabilities the spec cares about most — **turn-by-turn navigation** and the **manual building system** — through their real UI, and found the worst bug in the project. Marking a route `computing` wrote to a store that `<Shell>` subscribed to, and because `Rail` was declared *inside* `Shell`, every Shell render remounted the whole rail subtree. Result: the route panel remounted ~30×/second, its 60 ms compute timer was cancelled before it could ever fire, and **navigation never produced a route** — the exact symptom the user reported and twice shipped unfixed. Measured proof: `MOUNT … run … UNMOUNT` ×446 in 15 s, `status: "computing"` forever. Hoisting `Rail`/`MobileTabs` to module scope fixed it (route resolves in <500 ms). Two more defects fell out of the same investigation: `setMode` blanked the open panel, so switching 3D/Map closed the Route panel and killed the editor the moment "Trace a footprint" switched views; and the capability probe itself needed correcting twice before its PASSes meant anything. Sections 6, 10, 13, 17, 18 updated.
>
> **What changed in v1.2.** The first real *browser* review was run (a headless Chromium harness that drives real pointer and keyboard input and measures the camera before/after each gesture — HTTP smoke tests had hidden all of this). It found five defects that no unit test could see, all now fixed and gated: the getting-started card rendered a full-viewport `inset:0` backdrop that **blocked every interaction until dismissed** and blurred/dimmed the scene (reported as "zoom and movement not working" and "everything looks like a wash"); the default `misty-morning` fog at density 0.0013 left **2% visibility** at the default framing (a total whiteout — the real cause of "buildings look transparent / sludged"); the 2D roads layer **never rendered** because MapLibre rejects a data-driven `line-dasharray` and aborts the whole `addLayer`; `?b=<id>` deep links were **stripped from the URL by the app's own share-sync effect on mount** so they never flew anywhere; and arrow keys / `+` / `−` / `Esc` did nothing in orbit mode. Labels also gained a greedy screen-space de-collision pass. Sections 6, 10, 17 and 18 carry the new contract items.
>
> **What changed in v1.1.** v1.0 described *what to build*. v1.1 adds everything learned by building it and then reviewing the result against the real site: (a) an **audit of the generated model** with measured numbers, (b) the **quality bar** taken from `maps.iitmandi.co.in`, (c) the **defect register** from the first live review (transparency, "sludged in the hills", broken-feeling navigation, missing labels, dead zoom, misaligned 2D), and (d) the **manual building / manual label / transparency-adjustment layer** that lets the user repair anything the pipeline missed. Sections 5–11 and 17 are new or rewritten; nothing from v1.0 was dropped.

---

## 0. HOW TO USE THIS PROMPT

- **Paste order:** Section 1 → Section 18, as one message. Do not summarise, do not drop sections.
- Work **phase by phase** (Section 16). Never start a phase before the previous phase's acceptance gates (Section 17) pass.
- **Never rebuild from scratch to fix a defect.** Every fix in Sections 6–11 must be applied *in place*, in the existing codebase, with the existing data pipeline, and re-measured with the existing harness. "Efficient and proper" beats "clean rewrite" — a rewrite loses the measured evidence that the rest of the app is correct.
- If an instruction is ambiguous, or a real-world measurement is unknown, **ask** — never invent. Fabricated geometry that looks plausible is a failing grade.
- Every claim you make must be backed by a command's output, pasted in your reply.

---

## 1. ROLE

You are a senior **3D geospatial front-end engineer + technical artist** with production experience in `three.js` / `react-three-fiber`, `MapLibre GL JS`, DEM/terrain pipelines, GIS georeferencing, asset authoring, and accessible map UX. You write TypeScript, not JavaScript. You optimise for **measured real-world fidelity**, not screenshots that merely look nice.

You are building a **campus navigation web app for IIT Mandi (Kamand)** that does three things:

1. **Outdoor** — an accurate, interactive 3D digital twin of the real campus (terrain, roads, buildings with correct massing, windows, doors, roofs, retaining walls, trees, boundary walls) with search, routing, walking directions and deep links. **Fidelity of the physical campus is priority #1.**
2. **Indoor** — a navigation section with **zero fabricated spatial data** but a working local-first floor workspace: upload a real plan, place labels, connect the graph manually, test a route and export the reviewable floor JSON. Committed indoor data can drop in later with no refactor.
3. **Repair** — a **manual correction layer** the user can drive from inside the running app: draw buildings the pipeline missed, relabel buildings, override a building's category/height/seat, and rescale global transparency. This layer is not a debug tool; it is a shipped feature, because no pipeline over satellite-derived data is ever complete.

---

## 2. NON-NEGOTIABLE CONSTRAINTS

1. **Originality / IP.** `maps.iitmandi.co.in` is a *functional reference*, never an asset source. Do **not** download, copy, hotlink, decompile or reuse its code, JS bundle, `final.glb`, photos (`p1.jpg`, `p2.jpg`, `p3.jpg`), logo file, taglines, captions, fonts or CSS. Recreate *structure and capability* with your own original code, geometry, UI and copy. No screenshotting their UI as a texture. Use the institute's official logo only with permission, or a neutral placeholder wordmark.
2. **No hallucinated geography.** Every building, road, path, gate, stream and elevation must trace to a source: OpenStreetMap, Overture, a DEM, a survey point, the official ortho, or the estate office's published figures. Every object carries `source` + `confidence`. Unplaced facilities are **listed, not drawn**.
3. **Metric truth.** 1 world unit = **1 metre**. Real metres for heights, widths, road widths, floor heights, wall thickness. No "artistic scale".
4. **Axes locked.** Right-handed, Y-up. `+X = East`, `+Y = Up`, `−Z = North`. All converters assume it; never deviate.
5. **Indoor never invents data.** With no plan selected it shows an upload prompt; after a real plan is uploaded, labels and connections are still manual. No demo rooms, fake corridors or pixel-to-room guesses.
6. **Performance is a feature.** Section 15 budgets are hard requirements, verified on a mid-range Android phone.
7. **No secrets client-side.** Tile keys live in an env var or a server proxy; never commit `.env`.
8. **Accessibility & responsiveness** are acceptance criteria, not polish (Section 14).
9. **Ask-before-guess** for: campus topology you cannot verify, building heights, road hierarchy, which buildings are "hero" (detailed) vs "fill" (procedural).
10. **Report honestly.** State exactly what is real vs placeholder. Never claim fidelity you did not measure.
11. **No silent failure.** If a step cannot resolve (an entrance, a route, a footprint), the UI says so in words — `approximate`, `unsurveyed connector`, `skipped` — or the test fails. A user must never see a confidently wrong map.
12. **Campus first.** The 315 campus buildings are the polish target. Village houses on the surrounding hills are context: correct massing, no wasted detail, no extra effort.

---

## 3. THE QUALITY BAR — what `maps.iitmandi.co.in` does that you must match

Analysed as a *behaviour*, not copied as an asset. The official site is a CRA React SPA: a landing view of rotating campus photos, then a full-screen 3D map (three.js + react-three-fiber + mapbox-gl) loading a single hand-authored `final.glb` of the campus. Its defining qualities — the ones the first review of our build was measured against:

| Attribute | The bar | Implication for us |
|---|---|---|
| **Opacity** | *"Not even a single building is transparent."* Every building reads as solid, opaque, lit mass. | Default building opacity **1.0**; translucency is opt-in per building or via a global slider, never a side-effect of a material bug. |
| **Grounding** | Buildings sit **on** the hill — retaining plinths, cut platforms, visible foundations. They never look "sludged in" / half-buried. | Seating must compute pad = highest terrain under the footprint, and build a retaining plinth down to the lowest corner (Section 7). |
| **Roofs** | Solid, correctly wound, clearly readable as roofs from above and below. | Every footprint is capped with an upward-facing cap; zero downward-facing caps is a gate. |
| **Legibility at distance** | You can read the campus as a place: named buildings, a legible road hierarchy, orientation cues. | Every campus building carries a label; roads read as ribbons; the basemap is baked at high enough resolution to read the physical layout. |
| **Motion** | Orbit, zoom and pan always respond; the camera never fights the user. | Camera contract in Section 10 — the OrbitControls `target` trap is called out there because it caused the "zoom not working" defect. |
| **Scope discipline** | It renders *the campus*. It is not a valley-wide terrain toy. | Campus detail is high; context is cheap but honest. |

**Where we deliberately go further than the bar:** the official site is one static model. We ship *measured* data (real footprints, real DEM, real road graph), **routing with turn-by-turn walking steps**, a 2D map that shares the same data as the 3D scene, search, deep links, QR codes, a printable sheet, a transparency slider, and a **manual correction system** the official site does not have.

---

## 4. TARGET GEOGRAPHY & ANCHORS

- **Kamand campus (South)** — 31.7731102, 76.9842749. **North campus** — 31.7812939, 76.9975020. **Transit / Annexe** (for context) — 31.7062853, 76.9386734 / 31.7046930, 76.9365040.
- South campus sits at Kamand on the left bank of the Uhl; North campus runs along the Kataula Khad opposite Salgi; the two halves are joined by a narrow neck; ~538 acres of steep Himalayan terrain.
- Baked extent (do not change without re-baking everything): **W 76.9750 · S 31.7680 · E 77.0060 · N 31.7890**, ortho **2889×2302**, heightfield **768×614**, elevations **954–1661 m**.
- Project origin is a single exported constant (`ORIGIN` in `src/config/map.config.ts`). **Everything** — geometry, audits, tests — must use it. A test that hard-codes an origin reports false failures (it did once: 50.5% phantom inward faces).

**Published ground truth to check against** (from the institute's own pages): North campus built area **1,59,371 m²**; 13 academic buildings **67,145.43 m²**; 19 hostel blocks; 3 dining blocks **2,650.95 m²**; faculty/staff housing **26,664.47 m²**; guest house **5,829.68 m²**; plus Sports Complex and hospital, A-9 (deanery, 3rd floor), ~1,260 students and 141 faculty/staff housed. Hostel names: Beaskund, Dashir, Surajtaal, Suvalsar, Gaurikund, Vyas Kund (north); Mani Mahesh, Nako, Renuka, Chandrataal, Parashar, Suvalsar (south).

---

## 5. WHERE WE ACTUALLY ARE — audit of the generated model

Do not restart. This is the state of the delivered project; every number below came from a runnable command in the repo, and each one is a floor you must not regress.

**Data (`public/data/`)**
| Layer | Count | Notes |
|---|---|---|
| `buildings.geojson` | **898** | campus **315** (north **210** / south **105**), context **583** |
| Entrances | **315 / 315** campus | footprint vertex nearest the nearest road vertex; clamped to the footprint edge |
| Locator names | **15 OSM + 300 derived**, 0 junk | derived locators are structured (`Zone-Block-Index`), junk `"Building N"` names eliminated |
| `roads.geojson` | 50 | graph: **2,219 nodes**, 2 components |
| `pois.json` | **332** | north 210 / south 105 — every campus building is a routable destination |
| `unplaced.json` | 10 | listed, never drawn |
| `vegetation.json` | 2,800 | `derived`, threshold p42 = 0.277 |
| Floor area | campus **193,685.6 m²** | north **150k** / south **43k** / context **99k**; north vs published **−5.7%** |
| Terrain | 768×614 f32 | 954–1661 m |
| `indoor/` | optional committed plans | missing `index.json` ⇒ upload workspace remains available; no fabricated rooms |

**Defect fixes already landed and measured (do not regress; Section 17 gates them)**
- **Transparency / winding:** inward-facing wall triangles **4,304 of 8,522 (50.5%) → 0 of 8,524 (0.0%)**; downward roof caps **2,419 (100%) → 0**; upward caps **0 → 2,807**.
- **Sludge / seating:** seating rewritten to `pad = terrain max under footprint`, retaining plinth to `minMSL − 2.5 m`, 1.2 m apron at 0.45 m drop; `SeatRecord{padMSL,minMSL,reliefM,retainingM,floors,heightM}`; **16 footprints with >12 m relief flagged for survey**, not hidden.
- **Navigation:** the engine was never the problem — all 15 pre-existing named routes resolved, median snap 23 m, max 47 m. The failure was **destination starvation**: only 15 of 315 campus buildings had names. Fixed by the naming + POI passes. Campus connectivity now gates as **one component**; the second network component is a detached village trail cluster that must contain **zero** campus buildings.
- **Labels:** every campus building labeled, priority-tiered, distance-budgeted, frustum-culled at 2 Hz; manual labels share the exact same style/font/size; `labelsAll` toggle reveals the whole set.
- **Camera:** OrbitControls `target` is set **once on mount** and never passed as a prop; range 6–4200 m.
- **Manual layer:** `public/data/manual/*` + `src/data/overrides.ts` + live edit session (`?edit=1`) with 2D tracing and export.

**Honest gaps still open:** 16 high-relief footprints await survey; no committed indoor plans yet; the local Indoor workspace is available for real uploads and remains manual by design; context buildings are massing-only. Browser gates now cover the outdoor render and the local correction/floor workflows.

---

## 6. DEFECT REGISTER — the first live review, verbatim, with required outcomes

The user's own words, each with the root cause found and the outcome that closes it. **These are the acceptance criteria for the fix round.**

| # | User's words | Root cause found | Required outcome |
|---|---|---|---|
| D1 | *"buiding are transparent in 3d … even there roof are transparent"* | ~50% of wall triangles wound inward, so front-face culling exposed interiors; 100% of roof caps faced down. | 0 inward wall triangles, 0 downward caps, default opacity 1.0. **Gate: geometry audit.** |
| D2 | *"sludged in the hills"*, vs *"not even singli building is transparent [on the official site]"* | Flat-placed footprints on steep terrain: uphill corners buried, downhill corners floating. | Cut-platform seating + retaining plinth + visible apron; relief reported per building. **Gate: seating assertions + survey list.** |
| D3 | *"navigation part is not woking"* | Not the engine — only 15 of 315 campus buildings were named, so destinations did not exist in the UI. | All 315 campus buildings searchable and routable; routes end at the mapped **entrance**, never the centroid. **Gate: routing audit.** |
| D4 | *"in navigation i want to do it"* | Same as D3, from the UI side: no way to pick most destinations. | RoutePanel lists all campus destinations with filter + swap, entrance-first flyTo. |
| D5 | *"labeling not done on every building"*, *"some buildings not even generated"* | Label pass was distance-budgeted without a guaranteed tier; some footprints were skipped upstream. | Every campus building labeled (priority-ranked); skipped footprints reported as a visible list, never dropped silently; the manual editor can add what is missing. |
| D6 | *"buildings not allingning the 2d map"* | 2D and 3D derived geometry through separate paths. | 2D and 3D consume the **same** geometry module and the same origin; the trace layer draws from the same rings. |
| D7 | *"zoom and movment of map is not working at some place"* | `OrbitControls` `target` passed as a prop re-applied every React render, so the camera snapped back — it read as "stuck". | Target set once in the mount effect; pan/zoom/rotate damping tuned; range 6–4200 m. **Gate: Section 10 contract.** |
| D8 | *"some buiding if note generate d that i will generate them"* | Any satellite-derived pipeline misses structures. | Manual building system shipped in-app (Section 11). |
| D9 | *"transparency adjustment"* | — | Global opacity slider, 0.2–1.0, default 1.0, plus per-building opacity. |
| D10 | *"manual labeling … with same style and other and font and size"* | — | Manual labels render through the identical label component as automatic ones; no second style. |
| D11 | *"mainly focula on campus buidingg no need to put extra efforts for the other houses on the hill"* | — | Detail budget: campus = hero, context = massing, no polish on village houses. |
| D12 | *"zoom and movment of map is not working at some place"* (round 2: still felt dead on first load) | The getting-started card was a full-viewport `inset:0` layer with `backdrop-filter: blur(3px)` that **captured every pointer event** until dismissed 3 times. | Overlays are never full-viewport blockers: the wrapper is `pointer-events:none`, only the card accepts input, and the first real map interaction auto-dismisses it. **Gate: a live `elementFromPoint` at the map centre must return CANVAS.** |
| D13 | "everything looks like a grey wash, buildings look transparent" (round 2) | `misty-morning` was the default fog preset at density 0.0013: exp(−(0.0013·1393)²) = **2% visibility** at the default framing. | Default preset is `clear-afternoon`; every preset is bounded so ≥80% of the campus stays visible at the default distance and ≥85% at 400 m. **Gate: `tests/fog.test.ts`.** |
| D14 | 2D map "not aligning" / roads missing | MapLibre rejects a **data-driven `line-dasharray`** ("data expressions not supported") and aborts the entire `addLayer`, silently deleting the 2D roads. | Stairs are a separate layer with a static dash pattern; a console-error check in the browser gate fails the run on any MapLibre rejection. |
| D15 | QR / shared links "did nothing" | The share-URL effect rewrote `location.search` on mount from a stale closure and **destroyed the incoming `?b=` parameter** before the focus hook read it. | Deep-link intent is read from a frozen copy of the arriving query string, and the URL is not written back on the first render. `?b=<id|name>` focuses by id, then exact name, then unique prefix; an unresolvable link raises a visible toast. |
| D16 | keyboard control unstated but required | Only walk-mode WASD existed; arrow keys, `+`, `−` and `Esc` did nothing in orbit mode. | Orbit-mode keyboard contract (Section 10.5) implemented and measured. |
| D17 | labels "not done on every building" (round 2: labels stacked and unreadable in the north-core cluster) | The culler tested frustum containment only — no screen-space collision test. | Greedy screen-space de-collision, priority-ordered, with hand-named / manual / selected labels protected. **Gate: zero overlapping label rects in the live DOM.** |
| D18 | *"buildings not allingning the 2d map"* (round 2: the 2D view was unreadable) | The "plan" view inherited the 3D camera's 60° pitch, so it rendered obliquely; and all 332 POI labels were drawn with no de-collision, stacking into an unreadable mat. | The 2D view opens at pitch 0 / bearing 0 (and deliberately does **not** write pitch back into the shared camera, or the 3D view would get stuck top-down). 2D labels rank by POI kind, zone and zoom, then de-collide in two passes. **Gate: plan-pitch check + zero overlapping 2D labels.** |
| D19 | (found by the new harness) a layer silently missing | MapLibre rejects a **data-driven `line-dasharray`** and aborts `addLayer` — the 2D roads never drew and no test noticed. | Static-dash stair layer; the browser gate fails on **any** console error, so a dead layer can never ship quietly again. |
| D20 | (found by the new harness) label policy | An OSM `alcohol` shop node ranked top and labelled a hilltop; commercial POIs competed with campus places. | `UNLABELLED_POI_KINDS` / `SHOP_POI_KINDS` in `map.config.ts`: such places stay **searchable** but never take map space from a campus place. |
| D22 | *"navigation part is not woking"* — **third round, finally root-caused** | `Rail` (and `MobileTabs`) were declared **inside** `<Shell>`, so every Shell render created a new component type and remounted the entire rail subtree. `RoutePanel` writes `status:'computing'` to a store `Shell` also subscribes to ⇒ Shell re-renders ⇒ panel remounts ⇒ effect re-runs ⇒ `computing` again. The 60 ms compute timeout was cancelled on every cycle, so the engine was asked forever and answered never. | Component identity must be stable: **never declare a component inside another component**. Rail/MobileTabs are hoisted to module scope; Shell subscribes to a primitive (`route.status === 'ready'`), not the result object. **Gate: a route must reach `status:'ready'` in the capability probe, and the effect must not re-run while idle.** |
| D23 | (same investigation) the editor closing itself | `setMode` cleared `panel` on every mode change, so switching 3D↔Map closed the Route panel, and "Trace a footprint" (which switches to the Map view) closed the editor that had just started tracing. | `setMode` keeps the outdoor panel and only clears it for indoor, where it does not apply. |
| D24 | (same investigation) instrumentation that lied | The first probe asserted `layerVisible = visibility !== 'none'` — which is `true` when the map does not exist at all — and matched `Explore` against the rail's *empty-state* text. Two PASSes were meaningless. | Every assertion must be able to fail: assert store verdicts and layer state through dev-only probes, and match text only a specific panel renders. |
| D25 | (stress) the map locking up | Reading `offsetWidth` inside the placement loop forced a synchronous layout per marker per pass (332 × 2 per relayout) and hung the main thread. | Geometry is measured **once** at marker creation and cached; placement is pure arithmetic. |
| D26 | *"manual label editing is not working"* / *"manual building making not working"* | The editor used uncontrolled `defaultValue`s, so changing targets could leave stale controls; building-label overrides were not shown as editable in the same reliable path; free labels had add/remove but no edit control and were not drawn in 2D. | Controlled editor fields always reflect the selected building and draft. Building label overrides and free labels are editable, removable and persisted; free labels render in both 3D and 2D with the same label treatment. |
| D27 | *"if i want to remove some previous building not working"* | The Hide action patched `hidden: !building`, which is always `false` for a selected building, and the merge removed hidden buildings from runtime data, making restore impossible. | **Remove from map** immediately saves `hidden:true`; the building remains in the Edit list with **Show building** and **Revert**. 3D, 2D, POIs and labels all omit it until restored. |
| D28 | *"change colour of navigation path from black to red"* | The route used a dark casing and teal core in 3D/2D. | Route casing/core are red (`#650d12` / `#ff304f`) in both views; stairs retain a lighter red dashed treatment. **Gate: browser style check + screenshot.** |
| D29 | *"floor navigation ... upload digital floor footprint ... labelling ... manual and navigation floor"* | The old Indoor section was only an honest empty shell; it had no in-app way to load a real plan or build an indoor graph. | Indoor workspace: select building → upload PNG/JPG/WEBP/SVG/PDF or contract JSON → label manually → connect navigation points manually → find route only across connected edges → red route overlay → local persistence and **Export floor JSON**. No automatic room/corridor invention. **Gate: `tools/probe-floor.mjs`.** |
| D30 | *"manual editing should be efficient like a professional website"* | The first correction layer stored edits but did not define a complete editing interaction model: no reliable selection mode, vertex handles, closed-area preview, undo/redo stack, geometry validation, or affected-feature-only rebuild contract. | Ship a dedicated **Manual Studio** with Select / Remove / Draw footprint / Edit vertices / Label tools, visible handles, closed filled polygon preview, first-point snap, undo/redo, drag/insert/delete vertices, self-intersection and minimum-area validation, explicit Save/Cancel, and reversible removal. **Gate: a browser probe creates, edits, rejects an invalid and restores a footprint without touching unrelated buildings.** |
| D31 | *"manual building ... shape should be the area under the line joined the points"* | A trace can appear as points/outline while the editing contract did not guarantee a valid filled polygon or post-save vertex editing. | The boundary is a closed WGS84 ring; the fill is the authoritative footprint; every segment joins consecutive vertices and last→first; the saved feature has a closed ring with ≥3 non-collinear vertices. The same ring drives 2D fill, 3D massing, roof, windows, doors and labels. |
| D32 | *"I will import sections of images of floor maps and preview them"* | The first floor workspace accepted one underlay but did not define multi-image/page management, thumbnails, active-image preview, or overlay alignment persistence. | Import multiple floor images/pages, show a thumbnail strip and active preview with fit/zoom/pan, assign each asset to one building/floor, preserve labels/rooms/graph overlays by floor, replace/delete/reorder assets safely, and persist/export the mapping. **Gate: image gallery + reload + overlay probe.** |
| D33 | *"it should not lag"* | Rebuilding all geometry or measuring layout during every pointer move would make vertex editing and image preview janky. | Pointer moves update a lightweight overlay only; debounce persistence; rebuild only the changed building/floor after Save; use cached dimensions, requestAnimationFrame, memoised selectors and virtual/lazy image previews. No forced synchronous layout in marker/vertex loops, no whole-campus rebuild per vertex, zero console errors. **Gate: performance browser trace.** |

**Rule:** fix in place. No rewrite. Re-measure with the existing harness and paste the before/after numbers.

---

## 7. VISUAL CONTRACT — geometry, opacity, grounding

1. **Winding is never trusted from source.** OSM and Overture disagree on ring orientation. **All** triangles must flow through `triOutward` / `quadOutward` / a normal-checked `cap` in `src/scene/buildGeometry.ts`. This defect shipped once; the audit gates it at zero tolerance now.
2. **Roof caps face up.** No exceptions. Caps are generated per-footprint with the normal checked, not by trusting ring order.
3. **Opacity defaults to 1.0.** A building becomes translucent only if its own `opacity < 1`, or the user moves the global slider. Translucent meshes go into a separate batch with `depthWrite:false` and offset render order so they do not punch holes in opaque geometry.
4. **Seating (the anti-sludge rule).** For each footprint: sample terrain under the polygon → `padMSL = max`, `minMSL = min`, `reliefM = pad − min`. Build floor at `padMSL`, retaining plinth down to `minMSL − 2.5 m`, apron 1.2 m out / 0.45 m down. Buildings never float, never bury their uphill face. `reliefM > 12 m` ⇒ add to the **survey list** (16 today), keep the building visible, and mark it.
5. **Hero vs fill.** Campus buildings get windows (campus-only), parapets, readable roofscape, and a wall-colour ramp keyed by category (`WALL_COLOR_NAMES` is exported for the editor). Context buildings get extruded massing only.
6. **Colour & light.** Neutral hemisphere + directional light calibrated to a Himalayan morning; no blown-out whites (they hide geometry and read as "transparent"); walls must never render brighter than the sky behind them at the silhouette.
7. **Trees** are `derived` (inferred from the ortho at p42 = 0.277), tagged as inferred everywhere they appear, and never counted as survey data.

---

## 8. NAVIGATION CONTRACT

- **Destinations:** every one of the 315 campus buildings is a routable POI with name, zone, category and an entrance node. Nothing is routable unless it has a mapped entrance or the route is explicitly labeled *approximate*.
- **Snapping:** nearest road-graph node, cell ~27 m, median snap target < 30 m. Snap distance is shown in the steps if > 25 m.
- **Cost model:** walking speed **1.25 m/s**; ascent **+6 s per metre**; stair edges **×1.35**. Steps are clamped so a route can never overrun its own polyline.
- **Connectivity:** campus buildings must sit in **one** component of the road graph. Detached components (e.g. the village trail cluster) are allowed to exist but must contain **zero campus buildings**; crossing between components is only ever done via a ≤30 m edge explicitly marked **"unsurveyed connector"** and rendered as approximate.
- **Steps:** turn-by-turn list, entrance-first (`Enter <building> via <entrance>`), distance + time, with honest flags for approximate segments.
- **2D/3D parity:** both views read the same geometry, the same origin, and the same route polyline. A route that exists in 3D must exist identically in 2D. The route is visibly red in both views (`#ff304f` core; darker red casing).
- **Indoor:** the routing seam accepts a manually authored indoor graph. The Indoor workspace accepts a real plan underlay, manual labels and manual connections; it refuses a route when the graph is disconnected and never fabricates room geometry.

---

## 9. LABELING CONTRACT

1. **Coverage:** 100% of campus buildings have a label available. Labels are priority-tiered (by category, size, and distance from the campus centre) and distance-budgeted (e.g. tiers at 46 / 30 / 18 / 10 m, or 300 / 160 / 80 in `labelsAll` mode).
2. **Culling:** frustum-culled at 2 Hz — never per frame — so 315 labels cost nothing.
3. **One style.** Automatic and manual labels render through the *same* component with the same font, size ramp, halo/outline, background pill and occlusion behaviour. A manual label must be pixel-indistinguishable from an automatic one (that was an explicit request: *"with same style and other and font and size"*).
4. **Placement:** label anchors to the building's footprint centroid at roof height + camera-aware offset; manual labels may override `labelText`, `labelOffsetM`, `labelHidden`.
5. **No duplicates:** locator names are derived, but if an OSM name exists it wins; the label never shows the internal id.
6. **Both views:** free manual labels are visible in 3D and 2D, editable/removable from the Edit panel, and persist through the live session.

---

## 10. CAMERA & INTERACTION CONTRACT (the "zoom not working" fix)

1. **Never pass `target` to `<OrbitControls>` as a prop.** It re-applies on every React render and fights the user's pan/zoom — this *is* defect D7. Set the target **once** in a mount effect; afterwards only user input moves it, except explicit programmatic `flyTo`s (which must be one-shot).
2. Ranges: `minDistance 6 m`, `maxDistance 4200 m`. Polar clamp `minPolar 0.02`, `maxPolar π/2 − 0.015` (never allow going under the terrain). Damping: pan 1.1, zoom 0.95, rotate 0.85.
3. Zoom and pan must work **everywhere**, including over steep terrain, over buildings, and while a panel is open. If a raycast or an overlay is intercepting pointer events, that is the bug — not the controller settings.
4. Mode switches (3D ↔ 2D) must preserve the camera's geographic centre and the selected feature.
5. Keyboard: arrow keys pan, `+`/`−` zoom, `Esc` clears selection. Pointer-only interaction is a bug. Ignore keys while focus is in an input, and stand down while first-person walk mode owns the keymap.
6. **No full-viewport overlay may block the map.** Onboarding, dialogs, toasts and sheets are `pointer-events:none` wrappers with only the card clickable, and are never drawn with a backdrop blur/dim over the scene — that dim is indistinguishable from a rendering fault and hides the geometry. The map must be the top-most element at its own centre from the first frame.
7. **Fog is a visibility budget, not a mood.** Because fog is exponential-squared, densities must be chosen against the app's real framing distances (400 m close, ~1400 m default, up to 4200 m far) and gated in tests.
8. **Component identity is a correctness property.** A component declared inside another component remounts its whole subtree on every parent render. That is not a style preference — it cancelled a scheduled computation 30 times a second and silently broke routing. Keep components at module scope; subscribe to primitives, not freshly-created objects, in parents that own long-lived children.
9. **The URL is an input.** A deep link's parameters are read from an immutable copy of the arriving query string before any effect can rewrite the address bar; a link that cannot resolve says so instead of failing quietly.
10. **Editing input is latency-sensitive.** Never synchronously rebuild the entire scene, MapLibre source graph, label layout or localStorage record on each pointermove. Render the active edit overlay at the browser's animation cadence; commit expensive geometry and persistence only after Save or a debounced idle boundary.

---

## 11. THE MANUAL CORRECTION SYSTEM (shipped feature, not a debug tool)

The user must be able to repair the map from inside the map. The correction layer is a **Manual Studio**, not a debug panel. It must support: **select**, **remove/restore**, **draw a filled footprint**, **edit vertices**, **relabel**, **override attributes**, **edit/remove free labels**, **undo/redo**, **save/cancel**, and **transparency adjustment**.

### 11.1 Files (the whole persistence story — no backend)
```
public/data/manual/
  overrides.json     { note, buildings: { <buildingId>: BuildingOverride } }
  buildings.geojson  FeatureCollection, ManualBuildingProps  (buildings you draw)
  labels.json        { labels: [{ id, text, lat, lng, tier, elevM, offsetM }] }
  README.md          hand-editing instructions + provenance fields
```
`BuildingOverride`: `{ name, cat, floors, height_m, roof, pitch, wall, opacity, seatOffsetM, hidden, modelPath, labelText, labelOffsetM, labelHidden, note, verifiedBy, verifiedOn }` — all optional; only what you set is applied.

### 11.2 Precedence
`generated data` < `manual additions` < `manual overrides` < `live session edits`.
A bad manual entry must produce a **visible** `manualIssues` row in the accuracy HUD and be skipped — never a crash, never a silent drop.

### 11.3 Live session
- `?edit=1` enables the **Edit** tab and the tracing overlay; otherwise the app is read-only and the editor is not even mounted.
- **Draw:** the user clicks points on the 2D imagery; each point has a visible handle and every consecutive point is joined by a line. Clicking the first point or **Close shape** closes the ring. The polygon **fill/area under the boundary** is visible before Save. The overlay uses the same WGS84 ring in 2D and the preview 3D massing. Do not treat an open polyline as a building.
- **Edit:** Select a building → controlled fields override name, category, floors, height, roof, wall colour, opacity, seat offset and label. Fields must never retain a previous building's `defaultValue`. The selected footprint exposes vertex handles: drag a vertex, insert a vertex on a segment, delete a vertex, or undo/redo.
- **Remove/restore:** Remove from map immediately persists a reversible `hidden:true` override for generated buildings. Manual additions have a separate Delete action with confirmation and undo. Removed generated buildings remain in the correction list so Restore/Revert always works.
- **Labels:** free manual labels can be added, edited and removed; they use the same text style in 3D and 2D.
- **Validate:** refuse fewer than 3 points, zero-area/near-collinear rings, self-intersections, out-of-bounds coordinates and duplicate consecutive vertices. Show the exact error beside the drawing; never silently save a bad footprint.
- **Persist:** session edits auto-save to a versioned local session, but persistence is debounced; pointermove never serialises large data. `src/data/mergeEdits.ts` refreshes search + routing after Save, so a newly drawn building is immediately searchable and routable.
- **Export:** `exportFiles()` produces the exact `manual/*` file contents and a one-click copy/download, so the fix moves from the browser back into the repo and ships to everyone. Include provenance, operation history where useful, and a stable edit id.
- **Search refresh** after every edit; a building you drew is findable within the same session, without a reload.

### 11.4 Professional Manual Studio interaction contract

The Edit tab must feel like a small, reliable GIS editor:

- A visible tool strip: **Select**, **Remove**, **Draw footprint**, **Edit vertices**, **Add label**, **Undo**, **Redo**, **Save**, **Cancel**. The active tool is clearly highlighted and has an accessible name.
- Selection is unambiguous: selected building/footprint is outlined and filled with an edit tint; the side panel shows its id, provenance and dirty state. Escape cancels the current gesture without losing the last saved version.
- Draw mode has a live closed-ring preview. The first-point snap radius is visible/consistent; the Close action is disabled until 3 valid vertices exist. A self-intersecting bow-tie, a zero-area ring, duplicate vertices and coordinates outside the campus bbox are rejected with actionable text.
- Vertex mode uses handles large enough for touch and keyboard users. Dragging a handle updates only the active overlay; inserting/deleting a point updates the draft ring; undo/redo covers every geometry and field operation.
- Removing a generated building is reversible and distinct from deleting a manually added feature. Ask for confirmation for destructive deletion. Show a **Removed/Hidden** list with Restore.
- Save is atomic: validate the complete draft, persist once, update 2D/3D/search/routing, and clear the dirty flag. Cancel returns to the last saved state. A failed save leaves the draft visible and explains why.
- Use a lightweight edit overlay (SVG/Canvas/MapLibre source) during pointer movement. Do not call the full `buildBuildings()` or recreate all labels/markers until Save. Build only the changed feature, then merge it into the existing scene.
- The same closed ring is the single source for the 2D fill, 3D footprint, roof, doors/windows anchor, label anchor and export GeoJSON. There must be no 2D/3D drift.

### 11.5 Style parity
Edited and drawn buildings use the identical materials, seating, winding rules, window pass (campus) and label component as generated ones. There must be no visual tell that a building was hand-added — the only tell is the provenance field (`overridden: true`, `manual: true`) and the HUD count.

### 11.6 Indoor floor-navigation workspace

The Indoor tab is a real, local-first capture tool, not a fake empty map:

- Select a campus building and upload one or more real PNG/JPG/WEBP/SVG/PDF floor-plan images/pages or an indoor-contract JSON file.
- Store the floor label, elevation, floor height, source name, dimensions, rotation and metres-per-pixel scale. Use IndexedDB/object URLs for large local images; do not put multi-megabyte base64 images into every ordinary React render or unbounded localStorage record.
- Show a professional image gallery: thumbnails, file names, dimensions, active-floor selection, reorder, replace, delete with confirmation, fit-to-view, zoom, pan and optional opacity. Switching the active image must not lose floor labels, rooms or graph edges.
- Click the plan to place `room`, `door`, `stairs`, `lift`, `exit` or `waypoint` labels in normalised 0–1 coordinates. Allow inline rename, drag, removal and undo/redo.
- Add manual room/corridor polygons exactly like outdoor footprints: joined vertices, closed filled area, edit handles, self-intersection/zero-area validation and provenance. An image never becomes a room automatically.
- Connect labels manually as `walk`, `stairs`, `lift` or `ramp`; stairs are never step-free. Run Dijkstra/A* only across those explicit connections. Preserve graph edges when an image is replaced.
- Draw a red route on the plan for a successful path; show a clear no-route message for disconnected points.
- Persist local metadata/labels/graph under a versioned local session and image binaries in IndexedDB or another bounded browser store; never silently upload it. Autosave is debounced and shows a saved/dirty/error state. **Export floor JSON** plus referenced image assets produces a reviewable building/floor file. Committed data should replace browser object URLs/data URLs with relative plan assets and add room polygons/provenance per `docs/INDOOR_CONTRACT.md`.
- A plan image is an underlay, not a room detector. The app must never infer corridors, doors or rooms from pixels and present them as surveyed data.

---

## 12. DATA PIPELINE (reproducible, in this order)

```
tools/bake_tiles.py       Esri World Imagery (z17 ≈ 1.015 m/px) → ortho 2889×2302
                          AWS terrarium DEM (z15, h = R·256 + G + B/256 − 32768)
                          BBOX W76.9750 S31.7680 E77.0060 N31.7890, grid 768×614
                          → public/data/ortho/campus.jpg, terrain/height.f32, basemap.generated.ts
tools/build_data.py       OSM (Overpass) + Overture (S3 parquet via duckdb)
                          → zones → floors → roads → entrances → POIs  [ORDER IS MANDATORY]
                          → buildings.geojson, roads.geojson, areas.geojson, pois.json, unplaced.json
tools/build_vegetation.py adaptive p42 = 0.277 → vegetation.json (tagged derived)
tools/verify_accuracy.py  19 cross-checks vs published figures → PASS/WARN/FAIL
```
- `bake_tiles.py`: `HERE` is required; `__main__` must stay **last**; **never PNG-encode the DEM**, it is raw float32.
- `build_data.py`: the Overture branch needs `named = bool(name)`; area heuristics must **skip named** buildings; `campus_b` is defined once before the POI pass. Overture's `geom` arrives as an **object**, not a string. Overture has no height/floor data here — do not pretend it does.
- Every tool writes to `../public/data`, never to its own folder.
- Vegetation threshold is **adaptive** (fixed 0.28 once produced 80 trees instead of 2,800).
- After any pipeline change: re-run `verify_accuracy.py`, the tests, and re-bake-dependent checks. Regenerate `data.manifest.json` in the same command.

---

## 13. APPLICATION CONTRACTS (types, stores, invariants)

- **`BuildingProps`**: identity, `source`, `confidence`, `zone` (`north`/`south`/`context`), `name_conf`, `cat_conf`, `entrance_*`, `overridden`, `manual_note`.
- **`Confidence`** ∈ `surveyed | derived | inferred | approximate | manual`. Nothing is `surveyed` unless a human verified it.
- **SeatRecord** `{ padMSL, minMSL, reliefM, retainingM, floors, heightM }` — the old `seatMSL` field no longer exists.
- **Stores (zustand):** `uiStore` (`mode`, `panel: PanelId | null`, `railOpen` — `setMode` clears the panel only when entering indoor; outdoor 3D↔2D preserves it), `mapStore`, `outdoorStore` (`contextBuildings`, `labelsAll`, `globalOpacity`/`setGlobalOpacity`), `indoorStore`, `editStore` (`?edit=1`, `saved`, `addedBuildings`, `addedLabels`, localStorage `iitm-nav-edits-v1`, `exportFiles()`).
- **Search:** alias + Hinglish tolerant, searches names, locators, categories and POIs; edits refresh the index without reload.
- **Deep links:** `?b=<buildingId>` focuses a building (QR-code friendly); `?print=1` renders the printable sheet; `?edit=1` mounts the editor.
- **Indoor:** `data/indoor/index.json` plus the local upload workspace (`iitm-nav-indoor-v1`); absent committed data ⇒ upload prompt, not fabricated geometry. `routeOnFloor()` returns a path only over manually connected labels.
- **Unplaced facilities** are always listed, never drawn. **Unmatched entrances** produce steps flagged `approximate`. **Unsupported toggles** are disabled, not silently dead.

---

## 14. UI / UX SPEC

- **Clean, interactive, fast.** Dark-neutral chrome so terrain colours carry the scene; one accent colour for routes; no skeuomorphic clutter.
- Layout: TopBar (search, mode switch, layers) · left rail panels (Explore, Layers, Route, Edit, Indoor, About, Print) · accuracy HUD (counts: buildings, campus/context, manual, integrity rows) · viewport.
- **Panels:** Route (all 315 destinations, zone filter, category filter, swap origin/destination, entrance-first flyTo), Layers (context buildings, `labelsAll`, transparency slider with live %, editor CTA), Edit (professional Manual Studio: select/remove/draw/edit vertices/labels/undo-redo/save/export), Indoor (multi-image upload/preview/select floor/manual rooms/labels/connect/test route/export), About (sources, tolerances, honesty statement).
- **Responsive:** single-column on phone, rail collapses, tap targets ≥ 44 px, labels de-clutter by tier as the viewport narrows.
- **Motion:** damped camera, no layout jank, no spinner on cached data.
- **Accessibility:** full keyboard path, visible focus rings, ARIA on panels/toggles, colour contrast ≥ 4.5:1 on text, never colour-only encoding (routes/states also carry labels/patterns).
- **Error handling:** an `ErrorBoundary` that shows what failed and keeps the rest of the map alive; a data-load failure must never white-screen the app.

---

## 15. PERFORMANCE BUDGETS (hard)

- 60 fps target / 30 fps floor on mid-range Android with 898 buildings + 2,800 trees + terrain.
- Initial JS ≤ ~250 KB gzip for the entry chunk (measured: 70.20 KB entry, 74.80 react, 206.33 three, 217.54 maplibre — split by `manualChunks`; never merge them).
- LOD + instancing for trees and context buildings; label culling at 2 Hz; frustum culling on.
- Data loads once; no per-frame allocations in render loops; `depthWrite:false` only for translucent batches. Manual pointer moves update only a lightweight overlay; no forced layout, no full-campus geometry rebuild and no synchronous large-image decoding during a drag.
- Offline-baked basemap: no runtime tiles for the primary view; MapLibre is used for the optional 2D basemap only.

---

## 16. PHASE PLAN

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 | Contract & repo skeleton | types, stores, config, `ORIGIN` exported; tsc clean |
| 1 | Basemap bake | ortho + DEM + generated config; elevations match published range |
| 2 | Data build | buildings/roads/areas/POIs/vegetation + manifest; `verify_accuracy.py` PASS |
| 3 | Terrain + 3D scene | seating, winding, roofs, roads, trees; **geometry audit 0/0** |
| 4 | Labels + camera + interaction | 100% campus label coverage; camera contract holds |
| 5 | Routing + 2D map | routing audit green; 2D/3D parity |
| 6 | UI shell, search, deep links, print, indoor workspace | all panels usable; no-data state honest; real plan upload path wired |
| 7 | **Professional Manual Studio** | draw filled/editable footprints, remove/restore, vertex undo/redo, validation, label parity, affected-feature-only rebuild, export |
| 8 | **Floor image + graph workspace** | multi-image preview, manual floor geometry/labels/graph, indoor route, persistence/export, no-lag probe |
| 9 | Verification & handover | all gates in Section 17 green; outdoor + manual + floor probes; zip + docs + live preview |

---

## 17. ACCEPTANCE GATES (run these; paste the output)

```bash
npm install --no-audit --no-fund          # node_modules does not persist between sessions
npx tsc --noEmit                          # must be 0 errors
./node_modules/.bin/vitest run            # use the local binary, never bare npx
python3 tools/verify_accuracy.py          # 19 PASS / 0 WARN / 0 FAIL
npx vite build                            # must succeed; watch chunk sizes
npx vite --host 0.0.0.0 --port 5173       # live preview

# BROWSER OBSERVATION — the only gate that sees what the user sees.
# Drives a real Chromium with WebGL, measures the camera before/after each gesture,
# asserts the map is not covered, that every panel opens with its own content, and
# fails on any console error. Screenshots land in the output directory.
npm run shots                             # → node tools/shots.mjs [baseUrl] [outDir]

# CAPABILITY OBSERVATION — drives navigation and the manual editor through their real UI
# and fails on a route that never resolves.
npm run probe                             # → node tools/probe-capabilities.mjs [baseUrl]

# FLOOR CAPABILITY OBSERVATION — synthetic SVG underlay, manual labels, connections,
# indoor route, persistence; also checks edit/hide/restore/remove and zero console errors.
npm run probe:floor                        # → node tools/probe-floor.mjs

# NEXT PROFESSIONAL-STUDIO GATES — must be added/updated with this prompt.
npm run probe:manual-studio                # vertex draw/edit/undo/redo/validation/remove/restore/perf
npm run probe:floor-gallery                # multi-image preview/replace/reorder/overlay persistence/perf
```

> Model/harness note: `tools/shots.mjs` requires Chromium (`npx playwright install chromium`)
> and, in a bare container, the usual browser libraries. Without them the run must **fail
> loudly**, never silently skip — a render claim that was not observed is not evidence.

| Gate | Requirement | Current |
|---|---|---|
| Geometry audit | **0** inward wall triangles; **0** downward roof caps; caps-up > 1,000 | 8,524 walls / 0 inward / 0 cap-down / 2,807 cap-up ✅ |
| Seating | no building floats or buries; relief reported; >12 m relief listed | 16 flagged ✅ |
| Routing audit | all 315 campus buildings routable; entrances mapped; no junk names; campus in one component | ✅ (2nd component = village trail, 0 campus buildings) |
| Naming | 0 buildings named `Building N`; derived locators only as fallback | ✅ 15 OSM + 300 derived |
| Accuracy | `verify_accuracy.py` 19 PASS, north floor area within 15% | ✅ −5.7% |
| Tests | full vitest suite green | ✅ 38/38 |
| Build | `vite build` succeeds, entry ≤ budget | ✅ 70.20 KB gzip |
| Manual layer | draw → save → export → files re-load without loss; bad entries surface as `manualIssues` | ✅ |
| Honesty | every placeholder/approximation visible in the UI; no fabricated data | ✅ |
| **Browser interaction** | wheel zoom, drag-orbit, right-drag pan and keyboard all measurably move the camera; map centre is the canvas (nothing overlaying it); every rail panel opens with its own content; 2D map renders; `?b=` flies; `?print=1`; `?edit=1`; no horizontal overflow at 390 px | ✅ 22/22 |
| **Console cleanliness** | zero errors or warnings during a full interaction pass (catches silently-dead layers) | ✅ 0 |
| **Label legibility** | zero overlapping label rectangles in the live DOM, in **both** 3D and 2D | ✅ |
| **2D realism** | plan view at pitch 0, ≥8 layers loaded, and the viewport screenshot proves pixels were drawn (a blank canvas is ~7 kB, real imagery is far larger) | ✅ |
| **Navigation end-to-end** | engine reaches `ready` (not `computing`), distance + time + steps returned, route **drawn as a line** in 2D, and the summary survives switching back to 3D. Measured: A1 → North Campus building 01 = 2,622 m, 4,206 s, 50 steps, 352 m climb | ✅ 10/10 |
| **Manual correction system** | building label edit; Remove from map → Restore building; free label add/edit/remove; Trace a footprint → corners → Close shape → name → Save → remove; persisted/exported | ✅ `probe-floor` |
| **Red navigation path** | route casing/core visibly red in 3D and 2D; no black/teal default route | ✅ |
| **Floor navigation workspace** | select building → upload digital plan → manual labels → manual connections → route only over connected graph → red plan overlay → local persistence → Export floor JSON | ✅ `probe:floor` |
| **Professional manual studio** | select/remove/restore; draw a filled closed footprint; vertex drag/insert/delete; undo/redo; invalid-ring rejection; atomic save/cancel; affected-feature-only rebuild; no lag | ⏳ v1.5 gate |
| **Floor image gallery** | multiple image/page upload; thumbnails; active preview; fit/zoom/pan; floor assignment; replace/delete/reorder; labels/rooms/graph survive image changes and reload | ⏳ v1.5 gate |
| **Editing performance** | pointermove stays on lightweight overlay; no forced layout or whole-campus rebuild; persistence is debounced; browser trace has zero console errors and no interaction freeze | ⏳ v1.5 gate |

**Regression rule:** a gate that passes must never be allowed to fail later without the same measurement being pasted as evidence. If a fix could affect a gate, re-run that gate in the same turn.

---

## 18. DEFINITION OF DONE

1. Live preview opens, orbits, zooms and pans **everywhere** (D7 closed), on desktop and phone.
2. No building is transparent by default; no roof reads as see-through; nothing looks half-buried (D1, D2 closed).
3. Every campus building is labeled and every campus building is a routable destination ending at its entrance (D3–D5 closed).
4. 2D and 3D agree, feature for feature (D6 closed).
5. The user can draw/remove a missing building, relabel/edit/remove one, hide/restore a previous building, adjust global transparency, and export the result back into `public/data/manual/*` — with zero visual difference between hand-made and generated features (D8–D10, D26–D28 closed).
6. Context/village buildings are correct but not laboured over (D11 respected).
7. All Section 17 gates green; `verify_accuracy.py` reports OK; docs (`ACCURACY_LOG.md`, `DATA_SOURCES.md`, `INDOOR_CONTRACT.md`) match the current numbers.
8. Honesty statement in the About panel and README states exactly what is surveyed, what is derived, what is inferred, what is approximate, and what is missing; indoor upload data is explicitly local/manual until committed.
9. The delivery zip, the repo, and the live preview are the same build — no drift.
10. Indoor floor navigation accepts a real uploaded plan, manual labels and manual connections, and refuses disconnected/invented routes (D29 closed).
11. Manual Studio supports professional vertex editing, filled polygons, undo/redo, invalid-geometry rejection, reversible removal, atomic save/cancel and affected-feature-only rebuild without lag (D30–D33 closed).
12. Floor image gallery supports multiple uploaded plan images/pages with preview, floor assignment, overlay persistence, manual floor geometry/labels/graph routing and export.
13. Nothing was rebuilt from scratch to fix a defect; every fix was applied in place and re-measured.

---

*End of master prompt v1.5. Re-read Sections 5–11 at the start of every session: they are the contract the defects were measured against.*
