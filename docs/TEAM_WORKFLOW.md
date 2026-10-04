# Team Workflow — 6-person group project

> **How collaboration works in this app (honest version):**
> The app deliberately stores edits in **each browser's localStorage** — there is no server,
> so two people editing at the exact same moment cannot see each other's cursors live
> (that would need a sync server). What *is* supported, and works perfectly for a group
> deadline, is **parallel work + session merge**: everyone edits on their own laptop at the
> same time, exports one session file, sends it to the integrator, and the integrator
> **imports + merges all files in the Edit panel** (conflicts are kept safe and reported;
> every import is one Ctrl+Z away from rollback).

---

## The 6 roles (assign at the start, write names here)

| # | Role | Who | What they do in the app |
|---|------|-----|--------------------------|
| 1 | **Editor A — South campus** | ___ | Building corrections: names, floors/height, reshapes, remove/restore for all **South** buildings. Filter the list by "South". |
| 2 | **Editor B — North campus** | ___ | Same as A, but **North** buildings only. |
| 3 | **Route editor** | ___ | Only the Routes section: fix wrong routes (buildings crossing), draw missing paths. Do **not** edit buildings. |
| 4 | **Indoor editor** | ___ | Floor-plan uploads, room labels, connections, floor routing tests, floor JSON export. |
| 5 | **Integrator** | ___ | Collects everyone's session files → Import & merge → resolves conflicts → exports the final `manual/*.json` files. Owns the "final session". |
| 6 | **Release manager / QA** | ___ | Owns the repo and the zip: `npm test` (must be 55/55), `npm run build`, browser smoke, version naming, zipping, printing the QR sheet. |

> Roles 1–4 do **all** their work in the browser at `?edit=1`. They never touch the repo.
> Roles 5–6 are the only ones who produce files for the repo.

---

## The golden rule: zones don't overlap

Conflicts happen only when two people edit **the same building/road/label**.
With the split above that cannot normally happen — the merge is then purely additive.
If a crossover *does* happen (e.g. a boundary building), the merge keeps the
**integrator's existing value** for the contested field, still imports the other
person's *untouched* fields, and lists every conflict in a toast — nothing is ever
silently overwritten.

---

## Daily loop (every work session)

**Editors 1–4**
1. Open the app with `?edit=1`, open the **Edit** tab.
2. Fill **Your name** and **Your zone** in the *Teamwork* section (once).
3. Do your edits (everything previews live; Ctrl+Z for mistakes).
4. *Teamwork* → **Export my session** → sends `session-<name>-<date>.json` to the integrator (WhatsApp/Drive/email).
5. Keep your browser tab's storage untouched until the integrator confirms the merge.

**Integrator (5)**
1. Start from the *last known good* session (or a clean browser profile).
2. *Teamwork* → **Import teammate's session** → select all received files (multi-select works).
3. Read each toast: what merged, what conflicted. Conflicts → talk to the teammate, then either keep yours (done) or edit manually to their value.
4. *Export* section → download the 5 files: `overrides.json`, `buildings.geojson`, `labels.json`, `road_fixes.json`, `roads_manual.json`.
5. Hand files to the release manager (or place them into `public/data/manual/` if you have repo access).

**Release manager (6)**
1. Replace the files in `public/data/manual/`.
2. `npm test` → must pass, `npm run build` → must succeed.
3. Open the built app → 0 console errors → zip as `IIT-Mandi-Campus-Map-vX.Y-Final.zip`.
4. Share back to the group. Everyone can now also see the merged result by running the same zip.

---

## FAQ

**Can 6 people edit the same deployed website at once?**
They can all *open* and edit it simultaneously, but each sees only their own edits until
sessions are merged. Merging is a 30-second job per round.

**Working on the SAME building but different floors? (v2.1)**
Yes — indoor sub-assignments merge per floor label. Ravi uploads floor 1 with labels/photos,
Neha floor 2. Each clicks **"Export floor bundle (with images)"** inside that floor's editor.
The integrator opens the same building's Indoor page and imports both bundles from the upload
box: new floor labels are adopted whole; same-label floors **fill gaps only** — the integrator's
labels/connections/images are never replaced. Each person's author name (set once in the Edit
tab's Teamwork section) is stamped into their bundles automatically.

**Do uploaded floor photos travel with the merge? (v2.1)**
Yes — a floor bundle embeds the plan images themselves (base64), and the integrator's browser
stores them in IndexedDB on import. What does NOT travel: the plain "Export floor JSON" (that
formats for committing to the repo; use the **bundle** for sharing).

**A building gets renamed — do its floors keep the old name? (v2.1)**
No. Whenever the outdoor name changes (editor or a merged session), every local indoor copy
and all its floor listings and future exports update to the new name automatically.

**Someone made a whole different zip with an LLM (new buttons, new panels)? (v2.1)**
That's exactly the case the team-merge tool exists for. **There is no session file to export
in that case — because no session file is needed**: session files only carry *in-app manual
edits*. Changes made by AI editing the code are *already in a full project zip*, so that zip
itself IS the export. The integrator collects all the zips and runs:
```bash
node tools/team-merge.mjs --base ./v2.0 --contrib ravi=./ravi.zip --contrib neha=./neha.zip --out ./team-merged
```
It produces a merged tree + `TEAM_MERGE_REPORT.md`: files changed by exactly ONE person are
applied automatically; files changed by TWO+ people become **conflicts listed with each
person's copy path** — the integrator picks the best and copies it over the placeholder.
Files marked `deleted by` someone are also listed, never silently dropped.

**The three contribution channels, side by side (v2.2):**

| What the teammate touched | What they send | How the integrator merges it |
|---|---|---|
| Map edits in the app at `?edit=1` (buildings, labels, roads) | `session-<name>.json` ("Export my session") | Edit tab → Import teammate's session (multi-file, undoable) |
| Indoor floor work (plans, labels, corridors, photos) | `floor-bundle-<bldg>-<floor>-<name>.json` ("Export floor bundle") | Indoor tab → upload box on that building |
| Website code features via Arena/other LLMs | the whole project zip | `node tools/team-merge.mjs` + follow the report |

**My navigation does not follow real roads / roads are missing in places? (v2.2)**
That's a data gap, and it's fixable by the team:
1. **Outdoor**: turn on **Layers → "Show ONLY the road network"** (roads-only view) to see
   exactly what is mapped. Where a road is missing, go to `?edit=1` → Edit tab →
   **Draw a route**: clicks lay waypoints (they snap to the existing network), double-click
   finishes. The drawn road instantly becomes routable — the graph is rebuilt and a bad
   line is rolled back automatically. Export your session afterwards so the integrator
   gets your roads. Confirm your steps are valid before drawing: a road drawn through a
   building is reported by name.
2. **Indoor**: the floor route is NOT dot-to-dot. Draw **corridor paths** along real
   walkways in the Digital-floor-map editor (v2.2): click along corridors, click near an
   existing vertex to join a branch, double-click to finish. Room labels attach to the
   nearest corridor automatically, so the red route line follows your hand-drawn corridors
   and can never cut through a wall.
3. **Route options** (v2.2): when several legal paths exist, the Route panel shows up to 3
   options — Recommended + dull dashed alternatives on the map. Click an option chip to
   switch the active red route.
**The v2.0 BACKUP zip — rules**

`IIT-Mandi-Campus-Map-v2.0-BACKUP.zip` is a sealed restore point (md5 recorded when sealed).
- Never hand it to `team-merge` as a contributor (zips inside trees are ignored anyway)
- Never extract it into the repo — extract to a SEPARATE folder only
- Restore = extract → `npm install` → you are exactly at v2.0 again; nothing about it
  affects an ongoing merge because merges read only session/bundle files and contributor trees

**Can we skip file-sending?**
Only with a sync server (small Node + WebSocket service, one shared room key).
That is a bigger change and adds a "silent write path" this project deliberately avoids.
If the group later wants it, plan it as a separate phase.

**Git?**
Roles 5–6 are encouraged to keep `public/data/manual/` under git — the exported JSON is
stable, sorted and diff-friendly. Editors 1–4 never need git.

**Someone lost their edits?**
Edits auto-persist to localStorage per tab — refresh is safe. Only clearing browser
storage wipes them. Export your session after every work session and you're immune.
