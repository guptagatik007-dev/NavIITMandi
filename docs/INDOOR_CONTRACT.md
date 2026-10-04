# INDOOR DATA CONTRACT

**Status: the section is a real floor-plan workspace.** No campus floor plan is fabricated.
A building appears in the Indoor section when a real, traceable plan is committed here
or uploaded by the person doing the survey. Browser uploads are a local correction
workspace; they do not silently become shared repository data.

Hand this document to whoever digitises the plans. Drop the files in and the section
activates with **no application code changes**. For a faster manual pass, use the Indoor
tab's upload workspace, label the plan, connect the points, test the route, then click
**Export floor JSON** before committing the result.

---

## 1. Where files go

```
public/data/indoor/
├─ index.json                     # index of buildings that have indoor data
└─ <buildingId>/
   ├─ building.json               # REQUIRED: floors, rooms, vertical connections, graph
   ├─ floor-<floorId>.svg         # optional: traced plan used as a visual underlay
   └─ graph.json                  # optional: graph split out of building.json
```

`<buildingId>` **must equal** the `id` of a building in `public/data/buildings.geojson`
(for example `osm-310578815` or `ovt-A1b2C3d4E5f6`). This is what links the indoor plan to
the outdoor footprint, so the outdoor route can finish at the correct door.

## 2. Coordinate system (the part people get wrong)

* Units are **local metres**, per floor. `x` increases **east**, `y` increases **north**.
  Not pixels, not latitude/longitude, not a CAD unit.
* The plan's origin is declared once per building in `origin` (WGS84) plus
  `rotationDeg`: the angle you must rotate the plan clockwise so that its `+y` axis points
  to **true north**.
* `scaleMPerUnit` exists so a plan traced in arbitrary units can be corrected without
  re-tracing. Set it to `1` if you already worked in metres.
* Floors stack by `elevationM` (absolute metres above mean sea level) and `heightM`
  (floor-to-ceiling plus slab). These must agree with the outdoor terrain height at
  `origin`, otherwise rooms will not line up with the building that contains them.

```jsonc
{
  "id": "osm-310578815",
  "name": "Academic Block A1",
  "origin": { "lat": 31.775250, "lng": 76.985370, "rotationDeg": -12.5 },
  "scaleMPerUnit": 1,
  "floors": [ /* see §3 */ ],
  "graph":  { "nodes": [], "edges": [] },   // see §4
  "surveyedBy": "name / roll no",
  "surveyedOn": "2026-10-04",
  "source": "DWG drawing A1-FP-01 rev C, checked against a tape survey on site"
}
```

## 3. Floors and rooms

```jsonc
{
  "id": "G",
  "label": "Ground",
  "elevationM": 1023.4,      // floor level, MSL
  "heightM": 3.6,            // floor-to-ceiling + slab
  "planSvg": "floor-G.svg",  // optional
  "rooms": [
    {
      "id": "G-101",
      "name": "Lecture Hall 1",
      "kind": "hall",        // room | lab | office | washroom | hall | amenity | stair | lift | lobby
      "polygon": [[0,0],[12.4,0],[12.4,8.2],[0,8.2]],   // local metres, closed or open ring
      "label": "LH-1"        // optional short label drawn on the plan
    }
  ]
}
```

Rules:
* Room polygons must not overlap. Adjacent rooms share an edge, not a band of area.
* Corridors are rooms of kind `amenity` (or add an explicit corridor kind if you prefer —
  they are only used for display, the graph carries the routing).
* A room with no polygon is rejected by the loader: a grid reference is not a plan.

## 4. Routing graph

The graph is what makes navigation work; the polygons are what makes it readable.

```jsonc
{
  "nodes": [
    { "id": "n-101-1", "x": 6.2, "y": 1.0, "floorId": "G", "kind": "walk" },
    { "id": "door-101", "x": 6.2, "y": 0.0, "floorId": "G", "kind": "door" },
    { "id": "stair-g-1", "x": 14.0, "y": 6.5, "floorId": "G", "kind": "stairs" },
    { "id": "stair-1-1", "x": 14.0, "y": 6.5, "floorId": "1", "kind": "stairs" },
    { "id": "lift-g", "x": 15.2, "y": 6.5, "floorId": "G", "kind": "lift" },
    { "id": "lift-1", "x": 15.2, "y": 6.5, "floorId": "1", "kind": "lift" },
    { "id": "exit-main", "x": 6.2, "y": -1.2, "floorId": "G", "kind": "exit" }
  ],
  "edges": [
    { "from": "n-101-1", "to": "door-101",    "kind": "walk",   "weight": 1.2,  "accessible": true },
    { "from": "stair-g-1","to": "stair-1-1",  "kind": "stairs", "weight": 3.6,  "accessible": false },
    { "from": "lift-g",   "to": "lift-1",     "kind": "lift",   "weight": 12.0, "accessible": true }
  ]
}
```

* `weight` is the traverse cost. Use **seconds of walking**, not metres, so lifts (long
  wait, short distance) score correctly against stairs.
* `accessible: false` on any stair edge is what makes the step-free profile work. A stair
  edge with `accessible: true` is treated as a data error.
* At least one node should be `kind: "exit"` whose position matches, within 3 m, the
  building's outdoor entrance. That is the seam between the indoor graph and the outdoor
  network, and it is what lets a route read *"…enter by the north door, take the lift to
  the second floor, room 214"*.

## 5. Index file

```jsonc
{
  "buildings": [
    { "id": "osm-310578815", "name": "Academic Block A1", "floors": 3, "surveyedOn": "2026-10-04" }
  ]
}
```

The app reads `index.json` first, then lazily loads `building.json` per building. A missing
or unparsable file is treated as **"no data"**, never as an app error — the empty state
stays honest instead of breaking the map.

## 6. Digital capture pipeline (recommended)

1. **Source** — estate-office DWG/PDF, or a traced survey. Record the drawing number and
   revision in `source`.
2. **Georeference** — export DXF/PDF pages, set the origin and `rotationDeg` against the
   outdoor footprint, then verify by overlaying the plan on the ortho in the app's
   **alignment overlay** (`?debug=align`).
3. **Trace rooms** — CAD or image tracing → polygons in metres. Close every polygon.
4. **Extrude for the 3D view** — walls as 0.10–0.15 m extrusions, door openings cut,
   windows left open (the outdoor facade already carries them).
5. **Build the graph** — one node per room centre and one per door, stair and lift landing;
   connect with edges. Reuse the **same A\*** the outdoor map uses; it is already tested,
   generic over graphs, and understands `stairs`, `lift`, `ramp` and the `accessible` flag.
6. **Anchors for "you are here"** — one QR code per landing, encoding
   `?mode=indoor&b=<buildingId>&floor=<floorId>&anchor=<nodeId>`.
7. **Validate** before committing:
   ```bash
   npm test        # includes the empty-graph case and the accessible-profile invariant
   npm run verify  # checks every indoor file against this contract
   ```

## 7. Definition of done for one building

* `building.json` parses, every polygon has ≥ 3 vertices, no overlapping rooms.
* Every room is reachable in the graph from at least one `exit` node.
* A `fastest` route exists between any two rooms; the `accessible` profile succeeds
  wherever a lift serves the floors involved, and refuses honestly where it does not.
* The exit node lines up with the outdoor entrance within 3 m.
* `surveyedBy`, `surveyedOn` and `source` are filled in — if they are empty, the data is
  an unsigned sketch and does not belong on a navigation map.

## 8. Browser upload and manual floor-navigation workspace

The Indoor tab now provides a working capture loop for a person who has the drawing but
has not yet committed a data file:

1. Select the exact campus building.
2. Enter the floor label, elevation, floor height and metres-per-pixel scale.
3. Upload **PNG, JPG, WEBP, SVG or PDF**, or upload a contract JSON containing a `floors`
   array. The image/PDF is an underlay; the app does not pretend that pixels are rooms.
4. Click the plan to place labels. Each label has normalised `x`/`y` coordinates in the
   range 0–1 and a kind: `room`, `door`, `stairs`, `lift`, `exit` or `waypoint`.
5. Connect labels manually as `walk`, `stairs`, `lift` or `ramp`. Stair edges are always
   marked non-step-free. A route is returned only when a connected graph path exists.
6. Choose two labels and use **Find floor route**. The tested route is drawn in red on the
   plan. Disconnected points produce an honest no-route message.
7. Use **Export floor JSON** and commit the plan/graph after checking the original drawing.

The browser workspace is persisted under `localStorage['iitm-nav-indoor-v1']`. It is a
session/correction layer, not a server write. Large raster uploads can exceed browser
storage; SVG or a smaller PNG is preferred for local work. The local floor shape is:

```jsonc
{
  "id": "G-local-id",
  "label": "Ground",
  "elevationM": 0,
  "heightM": 3.6,
  "planImageDataUrl": "data:image/png;base64,...",
  "planSourceName": "A1-ground.png",
  "planWidth": 2400,
  "planHeight": 1600,
  "scaleMPerPixel": 0.025,
  "rooms": [],
  "labels": [
    { "id": "room-101", "text": "Room 101", "x": 0.42, "y": 0.36, "kind": "room" },
    { "id": "door-main", "text": "Main door", "x": 0.08, "y": 0.52, "kind": "door" }
  ],
  "connections": [
    { "id": "edge-1", "from": "door-main", "to": "room-101", "kind": "walk", "accessible": true }
  ]
}
```

The committed contract should normally replace the browser data URL with a relative
`planSvg`/asset path and should contain surveyed provenance, room polygons and a graph in
local metres. The upload workspace is the manual bridge from a real drawing to that
reviewable contract.
