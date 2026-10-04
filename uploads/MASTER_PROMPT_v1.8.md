# MASTER PROMPT — IIT Mandi Campus Navigation System
### v1.8 — Building Inspector · Floors→Height Canon · Route Editor · HD Edit Basemap · 3D Texturing
**Binding specification. Supersedes v1.7. Zero-tolerance wording: every rule is testable.**

---

## §0. NON-NEGOTIABLE GROUND RULES (violation = reject the change)

| # | Rule | Test |
|---|------|------|
| G1 | Never break existing working features: 3D terrain, 898-building render, routing, search, labels, indoor workspace, deep links, exports. | All 38 existing tests pass; manual smoke of every rail tab. |
| G2 | No full rewrites of working modules. In-place, additive changes only. | Diff touches only named files per phase. |
| G3 | No invented geospatial data. Corrections are human-driven through the editor. | No new auto-generated geometry from imagery. |
| G4 | Every manual edit MUST: (a) preview live while dragging, (b) persist in localStorage, (c) export to `public/data/manual/*` reproducing byte-identical results on reload. | Drag slider → scene changes; save → F5 → identical scene. |
| G5 | `tsc --noEmit` = 0 errors. `vite build` succeeds. Entry bundle ≤ 250 KB gzip (vendors code-split). | CI gates. |
| G6 | Routes render red everywhere (already true — `#ff304f` core, `#650d12` casing). | Visual check 2D + 3D. |
| G7 | Removed buildings are never lost: always listed in the editor, restorable in one click. | Remove → F5 → restore → building back. |

---

## §1. BUILDING INSPECTOR (double-click = full context) — STATUS: ✅ DELIVERED v1.8

**Spec.** Double-clicking ANY building (generated OR manual), in 3D AND in Map view, MUST:
1. Select the building (bright highlight outline).
2. Open the Edit panel automatically (when `?edit=1`).
3. Show a single **inspector block** containing EVERYTHING for that building:
   - identity chips: id, category, floors, height, `generated|manual`, `hidden`, `edited`
   - actions: **Fly to**, **Navigate here** (sets destination → route panel), **Route from here**, **Inspect in Map**
   - full parameter editor (§2)
   - **Remove from map / Restore** (reversible, works identically for generated and manual buildings)
4. Double-click empty ground deselects.

**Delivered implementation:** `Map2D.tsx` dblclick handler (doubleClickZoom disabled), `Campus3D.tsx` `onEditPick` on walls/roofs/transparent meshes, inspector block at top of `EditPanel` Editing section, `Esc` deselects.

**Acceptance:** dblclick building in 3D → Edit panel open with that building's inspector + working sliders. Same in 2D. Generated buildings behave EXACTLY like manual ones.

---

## §2. HEIGHT = FLOORS × FLOOR-TO-FLOOR (campus canon) — STATUS: ✅ DELIVERED v1.8

**Rule H1 (canon):** every building uses the same per-floor height `f2f = 3.6 m` (already the project default). Editing the **Floors** slider MUST immediately recompute `height_m = round(floors × 3.6 + 1, 2)`.
**Rule H2:** the **Height** slider may still override manually afterwards; a floor change then re-syncs it.
**Rule H3:** the Height field label MUST state the active rule (e.g. "auto follows floors × 3.6 m").
**Rule H4 (live preview):** dragging ANY slider (floors, height, pitch, opacity, seat, wall, roof) MUST update the 3D model and 2D extrusion IN THE SAME FRAME — before Save. Previously the draft was invisible until Save (root cause of "shows height/floors but not editing"). Fixed by folding `edit.draft` over the target inside `mergeEditSession` via `LoadedApp`.
**Rule H5:** Save persists exactly what is on screen; nothing else changes.

---

## §3. EDITING PARITY (generated ≡ manual) — REQUIRED

1. A generated building double-clicked becomes an *override record* (`overrides.json`) — never a second copy of the building.
2. Remove/Restore, name, category, floors, height, roof, pitch, wall, opacity, seat offset, label text — ALL editable on generated buildings, byte-identical code path to manual buildings.
3. Manual (traced) buildings additionally allow permanent delete.
4. Every field shows its *effective* value (draft ⟶ saved override ⟶ generated default) — never a stale default.

---

## §4. ROUTE EDITOR + NEW ROUTE TOOL — PHASE: NEXT (binding spec)

Today's defect: generated routes sometimes cross building footprints, and missing paths cannot be added.

### 4.1 Edit an existing route segment
- With edit mode on, **double-click a route polyline** (the rendered red line, or a road in `roads.json`) → **route-edit mode**:
  - every vertex of that road/polyline shows a draggable handle (2D Map view primary; 3D optional)
  - click an edge → insert vertex; right-click a vertex → delete; drag → live preview
  - `Esc` cancels, `Ctrl+Z` undoes, **Save** writes the corrected geometry
- Storage: new manual layer `public/data/manual/road_fixes.json` `{roadId, ring:[...]} `. On load, corrected geometry REPLACES the generated road segment before graph build. Export must reproduce the graph identically.
- Validation: reject self-intersections; warn if the corrected line intersects any building footprint (list the buildings).

### 4.2 Draw a NEW route (point-to-point)
- Toolbar button **"Draw a route"** (edit mode, Map view):
  1. click = **start point** (green marker)
  2. subsequent clicks = intermediate waypoints (white markers)
  3. double-click / Enter = **end point** (red marker) → polyline finalizes
  4. name it (e.g. "path behind A-block"), pick surface (footpath / road / stairs) → Save
- On save the new polyline is **split at junctions, snapped to the nearest graph nodes within 8 m, and merged into the route graph**, so navigation can use it immediately. `Esc` aborts at any time; `Ctrl+Z` removes the last point.
- Stored in `public/data/manual/roads_manual.json`; merges with generated roads (generated roads keep their ids; manual ids prefixed `mroad-`).
- Graph invariant preserved: the merged graph MUST stay a single connected component; the build runs the existing connectivity audit and surfaces any new island to the editor.

### 4.3 Building-crossing guard
- After any route edit/draw, run an intersection test of the polyline against all visible building footprints; flag violations in the editor with a click-to-zoom list. Violations are allowed for stairs/tunnels only when the user explicitly confirms.

---

## §5. ULTRA-HD BASEMAP FOR EDITING — PHASE: NEXT (binding spec)

Goal: tracing a building outline against the 2D imagery is exact — crisp edges at max zoom.

1. **Tile bake upgrade:** re-bake ortho tiles at zoom 19 (target 20 where source allows) at ≤ 60 KB/tile average, WebP q80; keep current tiles as fallback. Output under `public/data/ortho_hd/`, manifest `ortho_hd/index.json` (bbox, minzoom, maxzoom, attribution).
2. **Edit-mode source switch:** when `?edit=1` AND zoom ≥ 17.5, Map view swaps the raster source to the HD layer; below that it uses the existing fast layer (no bandwidth blow-up).
3. **Graceful degradation:** if `ortho_hd` is absent (not baked yet), fall back to current tiles with no error.
4. **Scale readout:** a live scale bar + cursor lat/lng readout appears in edit mode so traced dimensions are verifiable.
5. Constraint: `node_modules`-free bake script under `tools/` (same style as existing bakers), documented in `docs/DATA_SOURCES.md`.

---

## §6. 3D MODEL LOOK — TEXTURES & GRAPHICS — PHASE: FOLLOW-ON (binding spec)

Procedural only (no external images, keeps bundle lean):
1. **Facade texture atlas:** one 512×512 canvas-generated atlas (window grid, door, parapet, concrete bands) + per-wall-material variants (plaster, brick, precast); UV-map walls by storey so windows scale with `f2f`.
2. **Roof materials:** distinct flat/sloped tones + subtle roughness variation; hipped/multi-bay forms keep existing silhouette logic.
3. **Terrain drape:** existing ortho stays, but add a soft contact-shadow blob (radial gradient) under each building to ground it visually.
4. **Selected-building treatment:** current highlight stays + gentle emissive pulse ≤ 8% so edit targets are unmistakable.
5. **Perf guard:** all texture work MUST hold ≥ 55 fps desktop / ≥ 30 fps mobile tier; texture memory ≤ 32 MB; if a device tier can't, it silently falls back to flat colors.

---

## §7. LABEL ACCURACY (incl. building 198) — CONTINUING

- Every auto label anchors to its building's roof centroid; off-anchor labels are draggable in edit mode and the drag position persists (`labelOffset` in overrides).
- Known-bad names (e.g. **building 198**) fixed via the ordinary name field → lands in `overrides.json`, search index updates (already wired).
- Manual labels and auto labels share one font stack/size ladder (already true) — keep it that way.

---

## §8. EDITOR UX CONTRACT (all phases)

| Input | Result |
|-------|--------|
| Double-click building (2D/3D) | Inspector opens (§1) |
| `Esc` | Cancel trace/route-edit → deselect building |
| `Ctrl+Z` | Undo last vertex/route point while tracing |
| `Ctrl+S` | Save the current draft |
| Drag any slider | Live scene update in the same frame (§2 H4) |
| Remove from map | Hidden in 2D+3D, stays in list, one-click restore |
| Save + reload | Scene identical to what was on screen |
| Export | Files paste into `public/data/manual/` reproduce everything |

---

## §9. PHASE BOARD

| Phase | Scope | Status |
|-------|-------|--------|
| P1 | Double-click inspector (2D+3D), Esc/Ctrl+Z, floors→height canon, LIVE draft preview | ✅ v1.8 shipped |
| P2 | Route editor: edit existing polylines + draw new routes + crossing guard (§4) | ⏳ next |
| P3 | Ultra-HD edit basemap + scale/cursor readout (§5) | ⏳ next |
| P4 | Procedural facade/roof textures + contact shadows (§6) | ⏳ after P3 |
| P5 | Vertex reshape of existing building footprints, draggable labels, multi-image floor gallery (IndexedDB), full undo/redo stack | ⏳ after P4 |

Every phase closes with: `tsc` clean, build green, 38 tests pass, fresh versioned zip.

---
*End of v1.8 master prompt.*
