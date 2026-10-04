# Auto-alignment report (v3.3 image-correlation)

Method: per-building FFT normalized edge correlation of footprint boundaries against the z18 HD ortho (0.51 m/px).
Acceptance: ncc₂ ≥ 0.34, improvement ≥ 1.7×, 1.5 m ≤ shift ≤ 13 m, two-pass (≤10 m coarse + ≤4 m refine), neighbour-hop guard.

| id | shift (px) | shift (m) | corr before → after |
|---|---|---|---|
| ovt-6627cd004cc5 | +17,+17 | 12.2 | 0.125 → 0.358 |
| ovt-ca1173d839ed | -19,+11 | 11.2 | 0.156 → 0.363 |
| ovt-9e60665e88ae | -19,+10 | 10.9 | 0.088 → 0.411 |
| ovt-0e9da580f60a | -21,+3 | 10.8 | 0.09 → 0.347 |
| ovt-3cd8de8335f2 | -16,+13 | 10.5 | 0.115 → 0.35 |
| ovt-fc058814a565 | -18,+4 | 9.4 | 0.191 → 0.444 |
| ovt-5f834e481622 | -15,+5 | 8.0 | 0.056 → 0.361 |
| ovt-b90de7dbe2a2 | -15,-5 | 8.0 | 0.189 → 0.402 |
| ovt-91a1848da976 | -14,-4 | 7.4 | 0.157 → 0.342 |
| ovt-b1770862eee1 | -14,-3 | 7.3 | 0.068 → 0.352 |
| osm-484541624 | -13,+4 | 6.9 | 0.111 → 0.384 |
| ovt-5b1666baadb6 | -13,-2 | 6.7 | 0.213 → 0.371 |
| ovt-100d32a5b89a | -12,+3 | 6.3 | 0.144 → 0.365 |
| ovt-1ec4b01650a0 | -8,-3 | 4.3 | 0.182 → 0.359 |
| ovt-28c8183cc408 | -8,-2 | 4.2 | 0.151 → 0.354 |

## v3.4 — IMAGE-TRUE SIZING (2026-10-01)

Method: per-building (sx,sy) scale about centroid + <=2px nudge, maximizing mean Sobel edge magnitude under the boundary against the z18 HD ortho (0.51 m/px). Bars: final edge >=34 (imagery p90=22), improvement >=1.12x, scale change >=3%, area within 0.70-1.85x, neighbour-centroid hop guard. 200 buildings >=150 m2 evaluated -> 24 passed the numbers -> 24 review crops human-checked -> **9 committed** (red=old, green=new). Rejected (15): shrinks that cut visible structure, hops onto adjacent masses, L-shapes/rotation defects scale cannot fix (stay in per-building Align/Reshape).

| building | scale x,y | nudge px | edge before > after | area m2 before > after |
|---|---|---|---|---|
| ovt-100d32a5b89a (South Campus building 09) | 1.07, 1.01 | (-2,2) | 32.7 > 53.0 | 306.0 > 330.0 |
| ovt-9e60665e88ae (North Campus building 40) | 0.96, 0.94 | (-1,0) | 22.2 > 35.5 | 311.0 > 283.0 |
| ovt-4d54725322e3 (North Campus building 59) | 1.03, 1.07 | (1,0) | 27.1 > 41.8 | 221.0 > 244.0 |
| ovt-db700021c02c (North Campus building 48) | 0.92, 0.88 | (0,-2) | 24.3 > 34.3 | 268.0 > 218.0 |
| ovt-0e9da580f60a (South Campus building 12) | 1.07, 1.07 | (-2,2) | 41.8 > 55.2 | 267.0 > 306.0 |
| ovt-b1770862eee1 (North Campus building 80) | 0.99, 0.96 | (-1,0) | 39.4 > 51.6 | 163.0 > 155.0 |
| ovt-6115b3a30b4a (North Campus building 41) | 1.18, 1.05 | (0,-1) | 29.8 > 37.1 | 304.0 > 375.0 |
| ovt-5f834e481622 (South Campus building 03) | 1.09, 0.99 | (0,0) | 43.3 > 53.9 | 525.0 > 565.0 |
| ovt-a077862791cb (North Campus building 58) | 1.03, 0.99 | (0,0) | 35.2 > 41.0 | 221.0 > 224.0 |

## v3.4.1 — SMALL-STRUCTURE SIZING PASS (2026-10-01)

Extends v3.4 sizing to the 260 footprints of 50-150 m2 missed by round 1 (the small sheds/'yellow cells'). Same method, stricter small-target bars: final edge >=36, improvement >=1.15x, >=4% change, area 0.72-1.65x, centroid hop guard. 36 numeric candidates -> all 36 review crops human-checked -> **15 committed** (`v3.4.1-imgscaleS`). 21 rejected: hops between real neighbouring sheds, tree-canopy/ground patches with no visible structure, ambiguous multi-mass rows (consistent with v3.4 discipline).

| building | scale x,y | nudge px | edge before > after | area m2 before > after |
|---|---|---|---|---|
| ovt-ac82a37f1b2c (Unnamed building) | 1.08, 1.04 | (0,0) | 16.2 > 49.4 | 105.6 > 119.0 |
| ovt-f053831b164f (North Campus building 126) | 1.08, 1.25 | (0,0) | 16.3 > 48.6 | 55.8 > 75.7 |
| ovt-39e4609e792e (North Campus building 89) | 0.85, 0.85 | (0,1) | 16.5 > 38.6 | 133.2 > 96.3 |
| ovt-e6f042ff7c20 (Unnamed building) | 1.08, 0.97 | (0,1) | 20.4 > 46.4 | 120.7 > 126.8 |
| ovt-b2400b838b38 (North Campus building 99) | 1.11, 1.08 | (0,0) | 18.9 > 42.5 | 88.7 > 106.8 |
| ovt-9d9f5ed4508a (North Campus building 104) | 0.87, 0.85 | (-1,1) | 16.3 > 36.5 | 81.3 > 60.3 |
| osm-474552440 (Chandrataal Annexe) | 1.04, 1.06 | (-1,0) | 22.8 > 51.1 | 92.1 > 101.5 |
| ovt-dbd3a66cd3bc (Unnamed building) | 1.06, 1.04 | (0,0) | 19.7 > 38.1 | 109.6 > 120.8 |
| ovt-80757adb208b (Unnamed building) | 0.92, 0.85 | (-2,2) | 24.2 > 42.9 | 59.8 > 46.8 |
| ovt-55aeb4b84526 (Unnamed building) | 0.85, 0.85 | (0,0) | 22.6 > 38.8 | 60.3 > 43.6 |
| ovt-665a30e9e26e (Unnamed building) | 1.13, 1.18 | (0,0) | 27.0 > 43.9 | 50.2 > 67.0 |
| ovt-8c4c3e5e3fa8 (Unnamed building) | 1.06, 1.06 | (-1,0) | 23.6 > 38.1 | 97.3 > 109.7 |
| ovt-0c52f45c9046 (Unnamed building) | 1.08, 1.16 | (-1,2) | 26.5 > 39.0 | 117.9 > 147.9 |
| ovt-6b07bf1f5827 (North Campus building 108) | 0.97, 1.04 | (0,0) | 31.1 > 41.2 | 75.0 > 75.4 |
| ovt-5036608a0841 (Unnamed building) | 1.04, 1.25 | (0,1) | 33.9 > 44.9 | 88.9 > 115.3 |

## v3.5 — PLAZA CLUSTER FIX, from user's annotated 3D screenshot (2026-10-01)

User's screenshot (amphitheatre plaza): blue circle near building 70 / b03 west arm; green circle across b153-b02 cluster. Diagnosis rendered current rings over z18 ortho; targeted correlation (±22px translation) + human crop review of all 11 zone buildings.

**Committed ring moves** (`v3.5-plaza` overrides, note carries vector):
- b02 osm-762404672: (-19,+7)px — snaps onto the curved arc strip; its old east lobe mis-covered a separate hall
- b153 ovt-0a0d51f1fc47: (-23,+8)px — onto strip segment (was half on dirt rim)
- b70 ovt-0f1b30771782: (-14,+10)px manual measured — onto its visible pale-walled structure (was floating on tree canopy)
- b116 ovt-2c1fc5856b66 (+12,-6)px, b109 ovt-3e52c96956ed (+2,+4)px, b05 osm-762404670 (-3,+3)px — snug onto bands/domes
**Rejected after review**: b03 big-ring shift (multi-part complex — translation helps one part, breaks the domes; needs Reshape/split), b10 (twin-structure reassignment), b192/b132/b181 (no clear structure / neighbour hop).

**New footprints digitized** (were missing — "not generated") into public/data/manual/buildings.geojson (`v3.5-plaza-digitized`, approx outlines flagged in note):
- Amphitheatre NE hall (the hall b02's lobe used to mis-cover)
- Amphitheatre N annex B
(3 more drafts — annex A, hostel slabs NE-1/NE-2 — were DROPPED after the containment audit proved existing footprints already cover them.)

Gates: 82/82 tests, tsc clean, build green, footprint audit unchanged (3 known partial pairs, 1 known clamped road case, 0 new).

## v3.6 — Oak Mess node (2026-10-01)
labelAt (76.9987832, 31.7817506), inside the dome ring (containment verified); replaces crowded NE-rim position from derived POI.
