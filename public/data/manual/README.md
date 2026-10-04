# Manual correction layer

Three optional files. They are the supported way to fix anything the automatic pipeline
gets wrong — no code changes, no rebuild of the data pipeline.

| File | Use it for |
|---|---|
| `overrides.json` | Fix a building that exists but is wrong: name, category, floor count, height, roof, wall material, **opacity**, seating offset, or hide it entirely |
| `buildings.geojson` | Add a building that is missing from the source data (draw it in the editor, paste the export) |
| `labels.json` | Label a place that is not a building: gate, viewpoint, water point, ATM, shrine |

Every entry may carry `note`, `verifiedBy` and `verifiedOn`. Filled-in provenance is what
turns an entry from "someone's guess" into "verified data" in the UI.

Everything in this folder is loaded at runtime and validated; a bad entry produces a
visible warning rather than a silently broken map.
