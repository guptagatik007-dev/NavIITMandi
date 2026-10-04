#!/usr/bin/env python3
"""
build_vegetation.py — derive tree instances from the baked satellite ortho.

Method (documented, deterministic, seeded):
  1. Read public/data/ortho/campus.jpg (Esri World Imagery, z17, ~1 m/px).
  2. Score each pixel for vegetation as a combination of green dominance
     ((G-(R+B)/2)/255) and the G-R / G-B channel spreads.
  3. Threshold ADAPTIVELY at a percentile of the non-occupied scores, so tuning
     does not depend on the season/lighting of the imagery.
  4. Exclude building footprints (3 px buffer) and roads/paths (4 px buffer),
     and reject anything below DEM 962 m (Uhl river / nala beds).
  5. Sample positions with seeded Poisson-style rejection so output is
     byte-identical between runs (deterministic snapshot tests).
  6. Classify conifer vs broadleaf from the warm channel difference and size with
     a seeded log-normal.

OUTPUT: public/data/vegetation.json   [{lat, lon, h, r, species, conf}]

Honest note: this is *imagery-derived inferred* vegetation, not a tree survey.
Tagged conf:"derived"; heights/radii are plausible species ranges, NOT measured.
"""
import json, math, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(os.path.join(HERE, "..", "public", "data"))

TARGET_TREES = 2800
SEED = 20260912
MIN_SPACING_PX = 5.0
SCORE_PERCENTILE = 42.0


def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def main():
    meta = json.load(open(os.path.join(PUB, "basemap.meta.json")))
    bb = meta["bbox"]
    img = Image.open(os.path.join(PUB, "ortho", "campus.jpg")).convert("RGB")
    W, H = img.size
    a = np.asarray(img).astype(np.float32)
    r_ch, g_ch, b_ch = a[:, :, 0], a[:, :, 1], a[:, :, 2]

    # --- vegetation score -------------------------------------------------------
    green_dom = (g_ch - (r_ch + b_ch) / 2.0) / 255.0
    spread = ((g_ch - r_ch) + (g_ch - b_ch)) / 510.0
    lum = (r_ch + g_ch + b_ch) / 765.0
    score = np.clip(green_dom * 4.0, 0, 1) * 0.65 + np.clip(spread * 4.0, 0, 1) * 0.35
    score *= np.clip(1.3 - lum, 0.25, 1.0)          # dark water/asphalt score low

    # --- exclusion mask ---------------------------------------------------------
    occ = np.zeros((H, W), dtype=bool)
    my_top, my_bot = merc_y(bb["north"]), merc_y(bb["south"])

    def to_px(lon, lat):
        px = int(round((lon - bb["west"]) / (bb["east"] - bb["west"]) * (W - 1)))
        py = int(round((merc_y(lat) - my_top) / (my_bot - my_top) * (H - 1)))
        return px, py

    bj = json.load(open(os.path.join(PUB, "buildings.geojson")))
    for f in bj["features"]:
        ring = f["geometry"]["coordinates"][0]
        xs, ys = zip(*(to_px(x, y) for x, y in ring))
        # fill the polygon row-wise (cheap scanline rasterisation of the convex-ish ring)
        for y in range(min(ys), max(ys) + 1):
            if y < 0 or y >= H:
                continue
            crossings = []
            for i in range(len(ring)):
                x0, y0 = to_px(*ring[i][:2][::-1][::-1]) if False else to_px(ring[i][0], ring[i][1])
                x1, y1 = to_px(ring[(i + 1) % len(ring)][0], ring[(i + 1) % len(ring)][1])
                if (y0 <= y < y1) or (y1 <= y < y0):
                    t = (y - y0) / (y1 - y0)
                    crossings.append(int(x0 + t * (x1 - x0)))
            crossings.sort()
            for k in range(0, len(crossings) - 1, 2):
                xa, xb = max(0, crossings[k]), min(W - 1, crossings[k + 1])
                if xb > xa:
                    occ[y, xa:xb + 1] = True
        for x, y in zip(xs, ys):        # ensure the ring outline itself is masked
            if 0 <= x < W and 0 <= y < H:
                occ[y, x] = True

    rj = json.load(open(os.path.join(PUB, "roads.geojson")))
    for f in rj["features"]:
        for lon, lat in f["geometry"]["coordinates"]:
            px, py = to_px(lon, lat)
            if 0 <= px < W and 0 <= py < H:
                occ[py, px] = True

    occ = ndimage.binary_dilation(occ, iterations=3)

    dem = np.load(os.path.join(HERE, "terrain_grid.npy"))
    dh, dw = dem.shape

    def dem_at(lat, lon):
        j = int(round((bb["north"] - lat) / (bb["north"] - bb["south"]) * (dh - 1)))
        i = int(round((lon - bb["west"]) / (bb["east"] - bb["west"]) * (dw - 1)))
        return float(dem[min(max(j, 0), dh - 1), min(max(i, 0), dw - 1)])

    valid = ~occ
    threshold = float(np.percentile(score[valid], SCORE_PERCENTILE))
    probs = np.where(valid & (score >= threshold), score, 0.0)
    print(f"score threshold p{SCORE_PERCENTILE:.0f} = {threshold:.3f}  candidates = {(probs>0).sum()}")

    np_rng = np.random.default_rng(SEED)
    order = np.argsort(np_rng.random(probs.size))
    candidates = [int(i) for i in order if probs.flat[i] > 0]
    print(f"candidate pool: {len(candidates)}")

    trees, taken = [], []
    taken_arr = np.zeros((0, 2), dtype=np.float32)
    for i in candidates:
        if len(trees) >= TARGET_TREES:
            break
        y, x = divmod(i, W)
        if taken_arr.shape[0]:
            recent = taken_arr[-400:]
            if np.any((recent[:, 0] - x) ** 2 + (recent[:, 1] - y) ** 2 < MIN_SPACING_PX ** 2):
                continue
        taken_arr = np.vstack([taken_arr, (x, y)])
        lon = bb["west"] + (bb["east"] - bb["west"]) * (x / (W - 1))
        my = my_top + (my_bot - my_top) * (y / (H - 1))
        lat = math.degrees(2 * math.atan(math.exp(my)) - math.pi / 2)
        if dem_at(lat, lon) < 962.0:
            continue
        rr, gg, bbb = a[y, x]
        warm = (rr - bbb) / 255.0
        conifer = warm < 0.03
        h = float(np.clip(np_rng.lognormal(1.45, 0.28) if conifer else np_rng.lognormal(1.30, 0.32), 3.0, 24.0))
        trees.append(dict(lat=round(lat, 6), lon=round(lon, 6), h=round(h, 1),
                          r=round(h * (0.15 if conifer else 0.25), 2),
                          species="conifer" if conifer else "broadleaf", conf="derived"))
        taken.append((x, y))

    out = dict(seed=SEED,
               source="derived from Esri World Imagery z17 greenness + DEM water mask",
               method=("green-dominance/spread score, adaptive percentile threshold, seeded Poisson "
                       "sampling, 3 px building + 3 px road exclusion, DEM < 962 m rejected"),
               caveat="inferred vegetation, NOT a tree survey; heights are plausible species ranges",
               count=len(trees), trees=trees)
    with open(os.path.join(PUB, "vegetation.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"trees: {len(trees)}  conifers: {sum(1 for t in trees if t['species']=='conifer')}  "
          f"file {os.path.getsize(os.path.join(PUB,'vegetation.json'))/1024:.0f} KB")


if __name__ == "__main__":
    main()
