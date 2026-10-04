# Hero building models go here

This phase ships a fully procedural campus: every building is generated from its surveyed
footprint plus documented attributes (floors, roof form, wall family, window rhythm), which
is what keeps the whole campus inside the render budget with no hand modelling.

Hand-authored `.glb` models belong in this folder for the hero buildings listed in
`docs/MASTER_PROMPT.md` §7 (A-9, A18, academic complex, library, dining/SAC, sports complex,
one flagship hostel, main gate). The drop-in path is:

1. Export from Blender in metres, Y-up, origin at the footprint centroid, ground at z = 0.
2. Optimise: Draco geometry + KTX2 textures, LOD0 ≤ 60k tris, ≤ 3 MB per building.
3. Reference it from the building's `modelPath` in `public/data/buildings.geojson`
   (`CampusBuilding.modelPath` already exists in `src/data/loaders.ts`), and the scene will
   render the model instead of the procedural massing for that id.

Until then the procedural version renders, and the map says so in its About panel.
