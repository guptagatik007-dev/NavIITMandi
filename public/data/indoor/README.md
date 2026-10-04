# Indoor datasets live here

```
public/data/indoor/
├─ index.json                  # list of buildings with indoor data (currently empty, deliberately)
└─ <buildingId>/
   ├─ building.json            # floors, room polygons, corridor graph
   ├─ floor-<id>.svg           # optional traced plan for display
   └─ graph.json               # optional: split the graph out from building.json
```

`<buildingId>` must match the `id` of a building in `public/data/buildings.geojson`
(e.g. `osm-1234567`). The exact JSON contract is in **docs/INDOOR_CONTRACT.md**.

Nothing in this folder is auto-generated and nothing here is fabricated. Until real
surveyed plans are added, the Indoor section of the app shows an explicit empty state.
