# EXECUTION PROMPT — v3.2 "HD GROUND TRUTH" (2026-10-01)
Owner request (verbatim problems, paraphrased semantics preserved):
1. Hand-drawn path is not visibly confirmed inside navigation; new path overlaps the
   previous one; no way to know a drawn path reaches a specific building.
2. Auditorium + garden + fragments: footprints don't sit on the imagery ("2D print
   not covering my 2D structure correctly") — global misregistration exists.
3. Some buildings don't appear as 3D structures; academic cells read as nuisance fragments.
4. Missing: a DOOR function; roads must connect to doors and the result must appear in
   navigation. Older paths must be removable.
5. Base 2D imagery too soft — wants MANY high-quality satellite tiles baked as the
   bottom layer, as sharp as possible.
6. Roads-only view is too dull.
7. Red/dark routes still cut through the pink domes (Oak Mess area).
Reference analysed: maps.iitmandi.co.in (their carved blocks + terrain) — STYLE/WHY only,
never geometry copied; keeps our structural data as-is.

## Phase G1 — HD imagery bake (DONE first, gates the alignment work)
- Download Esri World Imagery z18 tiles for BASEMAP_META.bbox (0.031°×0.021°).
- Stitch to 5778×4604 (0.51 m/px, 2× the current z17 bake), save as
  public/data/ortho/campus.jpg (backup old → campus-z17.jpg). Keep same BBOX →
  terrain/ortho stay co-registered, nothing in code changes.
- ACCEPT: zip ≤ ~15 MB allowed (owner approved); imagery visually sharper at z17.5+.

## Phase G2 — navigation truth for drawn paths
- Routable confirmation: App's merge result `joined` map stored in uiStore
  (`roadJoins`) → Edit → Routes list shows ✓/✗ chip per hand-drawn road; toast on save
  says "✓ joined — in navigation" vs "✗ extend to a road or a DOOR".
- Door-snap: while tracing a road, the START click and final double-click ALSO snap to
  any hand-set building door within 25 m (door wins over generic road line when closer).
- Old-path removal: already v3.1 Hide; document in Routes help text inline.

## Phase G3 — campus datum alignment (the systematic 3-10 m slide)
- editStore `datumShift: {dxM, dyM}` (snapshot, undoable, session-export key).
- Applied at runtime merge: generated (non-manual) roads + campus buildings shifted by
  deg(datumShift) BEFORE graph build/render. Manual content untouched.
- UI: Edit → "Align campus to imagery": arrow keys shift campus 0.3 m (Shift = 1 m);
  HUD chip shows current offset; reset button; exported via `manual_overrides`-style
  session key + serialised into road_fixes.json `datum` for permanence.
- ACCEPT: no silent geometry rewriting; shift always displayed; per-building Align stays.

## Phase G4 — fragment hygiene
- Per-building "Dissolve fragment" button (hide + note, reversible via Restore).
- 3D build safety: footprints producing zero triangles / height_m<=1 render as a plinth
  (never invisible-on-3D); audit logs which ids plinthed.

## Phase G5 — visual polish
- Roads-only: backdrop #6a7a73, roads #ff6b5d width+1, casing opacity 1.
- Route-over-dome hard test: assert zero graph edges inside Oak Mess osm-762330812 area
  ids AND the sister dome; drop-and-report stays on.

## Gates
tsc · vitest all suites (+new: roadwork2 — datum-shift math, door-snap preference;
routeclip dome assertion) · vite build · playwright smoke (roads-only brightness,
Fix-shape rail — existing) + screenshot diff eye-pass.
Deliverable: IIT-Mandi-Campus-Map-v3.2-HDGroundTruth.zip.
