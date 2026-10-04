# MASTER PROMPT — IIT Mandi Campus Navigation System
### v1.7 — Professional Editing Workflow + Ultra HD Basemap + Route Editor
**Supersedes v1.6 · binding specification for all upcoming modifications**

---
## 🎯 Core Priorities for v1.7
The highest priority is making the manual editing workflow fast, intuitive, and professional — matching standard GIS editor behavior — so you can correct buildings, routes, and labels efficiently without fighting the UI. All changes must be applied in-place without breaking existing working functionality.

---
## 1. Critical Fixes & New Features Required

### 1.1 Ultra HD 2D Basemap for Accurate Editing
- The current baked orthoimagery is blurry at zoom levels needed for precise building tracing.
- **Requirement:** Bake/prioritize higher resolution satellite/ortho tiles for the 2D Map view, so individual building edges, paths, and features are clearly visible when zoomed in to editing level.
- When in edit mode (`?edit=1`), automatically enable highest available imagery resolution, no blurring/pixelation at 18+ zoom levels.
- Show a scale bar reference while editing to confirm distances are accurate.

### 1.2 Double-Click to Edit Any Building
- **Requirement:** Double-clicking any building (in *both 3D view and 2D Map view*) immediately:
  1.  Selects that building
  2.  Opens the Edit panel automatically
  3.  Scrolls the edit panel directly to that building's parameter fields
  4.  Shows vertex edit handles around the building footprint (for reshaping)
- No more manually searching the building list to find what you want to edit. What you click is what you edit.

### 1.3 Full Parameter Editor for All Buildings
When a building is selected for editing, show these editable fields clearly:
✅ Building name / label text
✅ Category (academic/hostel/dining/etc)
✅ Number of floors + height (meters)
✅ Roof shape + pitch
✅ Wall color/material
✅ Opacity slider (0.2 - 1.0)
✅ Seat/cut platform offset (fixes half-buried buildings)
✅ **Reshape footprint button:** enter vertex edit mode for this exact building
✅ Buttons: `Save changes`, `Remove building (reversible)`, `Restore`, `Delete permanently (manual buildings only)`

### 1.4 Vertex Reshaping for *All* Buildings (not just new draws)
You must be able to correct the shape of ANY existing building (generated or manual):
- Enter reshape mode from the edit panel for a selected building
- Visible draggable vertex handles on every corner of the footprint
- Click an edge to insert a new vertex
- Right-click a vertex to delete it
- Live filled polygon preview while dragging
- First-point snap for closing
- Self-intersection/zero-area validation before save
- `Save` to apply changes only to this building (never rebuild the entire 898 building scene on every drag)
- `Cancel` to revert to original shape

### 1.5 Standard Editor Keyboard Shortcuts
Match professional editing software muscle memory:
| Shortcut | Action |
|---|---|
| `Double Click` building | Open edit mode for that building |
| `Esc` | Exit current edit/vertex mode, deselect building, close any open trace |
| `Ctrl + Z` | Undo last action (vertex move, point placement, field change, delete) |
| `Ctrl + Shift + Z` / `Ctrl + Y` | Redo |
| `Ctrl + S` | Save current edits |
| `Delete` / `Backspace` | Delete selected vertex / selected manual building |
| `Space + Drag` | Pan map while editing |
| `Scroll` | Zoom in/out smoothly while editing |

### 1.6 Manual Route Editor (fix routes cutting through buildings)
Current bug: some routes incorrectly cut straight through buildings instead of following paths:
- **Requirement:** Double-click any existing navigation route to enter route edit mode
- Show draggable waypoints along the route polyline
- Drag waypoints to adjust path to follow actual roads/paths
- Click on the route line to insert new waypoints
- Right-click a waypoint to remove it
- **New custom route creation mode:**
  1.  Click to place start point
  2.  Click to place end point
  3.  Click anywhere to add intermediate waypoints
  4.  Route draws along your placed points
  5.  Save manual route segments that are missing from the generated road graph
- Validate that final routes do not intersect building footprints, warn if they do.
- Keep all routes red as requested previously.

### 1.7 Building Label Accuracy
- All labels must anchor correctly to the center/roof of their building, no floating labels offset away from their building
- When editing a building name/label, the label updates live on the map
- Support dragging labels to reposition them manually if the automatic placement is bad
- Match font/style/size for all labels (automatic + manual) as specified earlier
- Fix any mislabeled buildings (like building 198 and other incorrect entries) so names match the real structures

### 1.8 General Efficiency & Look Improvements
1.  **No lag during editing:** Vertex dragging and label editing runs at 60fps, no full scene rebuilds until save
2.  Clear visual highlight of selected building: bright outline, semi-transparent tint
3.  Visual vertex handles are large enough to click easily even on touch screens
4.  Show a clear status indicator when in edit/vertex/route mode so you never get stuck
5.  Add a tooltip showing what tool/shortcut is active
6.  Fix any z-fighting or rendering artifacts that make it hard to see building edges
7.  Improve lighting/contrast slightly so building outlines are clearer against terrain/imagery
8.  Auto-save edit drafts to localStorage so accidental page refresh doesn't lose work
9.  Show a clear "You have unsaved changes" warning before leaving edit mode

---
## 2. Non-Negotiable Rules
1.  ❌ **Never break existing working features:** 3D terrain, routing, search, existing exports, indoor navigation all must keep working exactly as they do now
2.  ❌ **Never fabricate fake building data:** Any correction is manual and user-driven
3.  ✅ All changes must keep the project passing `tsc --noEmit` with zero errors, production build succeeds
4.  ✅ Performance budgets preserved: entry bundle stays <250KB gzip, frame rate stays 30+fps on mobile
5.  ✅ All edits are exportable to the same `public/data/manual/*` file format, so your corrections are preserved permanently when committed
6.  ✅ Hidden/removed buildings always stay in the edit list and can be restored at any time.

---
## 3. Phase Plan
1.  Add double-click selection + edit panel opening
2.  Implement keyboard shortcuts (Esc / Ctrl+Z / Ctrl+Y)
3.  Add vertex editing for existing buildings
4.  Implement route editing + manual route placement
5.  Fix label anchoring + draggable labels
6.  Upgrade basemap resolution / edit-mode high-zoom imagery
7.  Polish UI/visual feedback for editing
8.  Final testing + build + deliver updated zip.

---
*End of v1.7 master prompt.*
