#!/usr/bin/env python3
"""
bake_tiles.py — IIT Mandi campus basemap baker (offline-capable).

Fetches at build time (never at runtime):
  * Esri World Imagery raster tiles  -> public/data/ortho/campus.jpg   (Web-Mercator, native z px)
  * AWS Terrain Tiles (terrarium)    -> public/data/terrain/height.png (16-bit, regular lat/lon grid)

Outputs a self-contained campus basemap so the app runs with ZERO network calls,
which is required for the sandboxed preview and for the offline fallback tier.

Attribution: Esri World Imagery, AWS Open Data Terrain Tiles / Mapzen.
"""
import io, json, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

# ---------------------------------------------------------------- config
# BBOX must cover the full data extent produced by tools/build_data.py, otherwise
# context buildings sit outside the imagery/terrain and fail tools/verify_accuracy.py.
BBOX = dict(west=76.9750, south=31.7680, east=77.0060, north=31.7890)
IMAGERY_ZOOM = 17          # ~1.0 m/px at campus latitude
DEM_ZOOM = 15              # ~4 m/px
DEM_GRID = (768, 614)      # output heightfield resolution (w, h) ~3.8 m/px, matches the z15 source
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "data"))
CACHE = os.path.join(os.path.dirname(__file__), "tilecache")
UA = {"User-Agent": "iitmandi-campus-nav/1.0 (academic project)"}

IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def deg2num(lat, lon, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def fetch(url, cache_key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cache_key)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return open(path, "rb").read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return data
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))


# ---------------------------------------------------------------- imagery
def bake_imagery():
    z = IMAGERY_ZOOM
    x0f, y0f = deg2num(BBOX["north"], BBOX["west"], z)
    x1f, y1f = deg2num(BBOX["south"], BBOX["east"], z)
    tx0, ty0, tx1, ty1 = int(math.floor(x0f)), int(math.floor(y0f)), int(math.floor(x1f)), int(math.floor(y1f))
    nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f"[imagery] z={z} tiles {nx}x{ny} = {nx*ny} tiles")

    jobs = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]

    def load(job):
        tx, ty = job
        data = fetch(IMAGERY_URL.format(z=z, x=tx, y=ty), f"img_{z}_{tx}_{ty}.jpg")
        return tx, ty, Image.open(io.BytesIO(data)).convert("RGB")

    canvas = Image.new("RGB", (nx * 256, ny * 256))
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, (tx, ty, im) in enumerate(ex.map(load, jobs)):
            canvas.paste(im, ((tx - tx0) * 256, (ty - ty0) * 256))
            if (i + 1) % 10 == 0:
                print(f"  stitched {i+1}/{len(jobs)}")

    crop = (int(round((x0f - tx0) * 256)), int(round((y0f - ty0) * 256)),
            int(round((x1f - tx0) * 256)), int(round((y1f - ty0) * 256)))
    out = canvas.crop(crop)
    os.makedirs(os.path.join(OUT, "ortho"), exist_ok=True)
    dst = os.path.join(OUT, "ortho", "campus.jpg")
    out.save(dst, "JPEG", quality=80, optimize=True, progressive=True)
    meta = dict(zoom=z, bbox=BBOX, width=out.width, height=out.height,
                mpp=156543.03392 * math.cos(math.radians((BBOX["north"] + BBOX["south"]) / 2)) / (2 ** z),
                attribution="Imagery (c) Esri, Maxar, Earthstar Geographics",
                crop_px=crop)
    print(f"[imagery] wrote {dst} {out.size} ~{os.path.getsize(dst)/1e6:.1f} MB")
    return meta


# ---------------------------------------------------------------- terrain
def terrarium_h(im):
    px = im.load()
    w, h = im.size
    out = Image.new("F", (w, h))
    o = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y][:3]
            o[x, y] = (r * 256.0 + g + b / 256.0) - 32768.0
    return out


def bake_dem():
    z = DEM_ZOOM
    x0f, y0f = deg2num(BBOX["north"], BBOX["west"], z)
    x1f, y1f = deg2num(BBOX["south"], BBOX["east"], z)
    tx0, ty0, tx1, ty1 = int(math.floor(x0f)), int(math.floor(y0f)), int(math.floor(x1f)), int(math.floor(y1f))
    print(f"[dem] z={z} tiles {(tx1-tx0+1)}x{(ty1-ty0+1)}")

    tiles = {}
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            data = fetch(DEM_URL.format(z=z, x=tx, y=ty), f"dem_{z}_{tx}_{ty}.png")
            tiles[(tx, ty)] = terrarium_h(Image.open(io.BytesIO(data)).convert("RGB"))

    # sample a regular lat/lon grid (equirectangular output, not mercator) 
    W, H = DEM_GRID
    grid = []
    hmin, hmax = 1e9, -1e9
    for j in range(H):
        row = []
        lat = BBOX["north"] + (BBOX["south"] - BBOX["north"]) * (j / (H - 1))
        for i in range(W):
            lon = BBOX["west"] + (BBOX["east"] - BBOX["west"]) * (i / (W - 1))
            mx, my = deg2num(lat, lon, z)
            fx, fy = mx - math.floor(mx), my - math.floor(my)
            tx, ty = int(math.floor(mx)), int(math.floor(my))
            t = tiles.get((tx, ty)) or tiles[min(tiles, key=lambda k: (k[0]-tx)**2 + (k[1]-ty)**2)]
            px_ = min(255, max(0, int(fx * 256)))
            py_ = min(255, max(0, int(fy * 256)))
            v = t.load()[px_, py_]
            hmin, hmax = min(hmin, v), max(hmax, v)
            row.append(v)
        grid.append(row)

    # encode as 16-bit grayscale PNG with a documented linear scale
    img = Image.new("I;16", (W, H))
    p = img.load()
    for j in range(H):
        for i in range(W):
            p[i, j] = int(round((grid[j][i] - hmin) / (hmax - hmin) * 65535.0))
    os.makedirs(os.path.join(OUT, "terrain"), exist_ok=True)
    dst = os.path.join(OUT, "terrain", "height.png")
    img.save(dst, "PNG", optimize=True)
    meta = dict(grid=[W, H], bbox=BBOX, minM=round(hmin, 2), maxM=round(hmax, 2),
                encoding="uint16: h = minM + (v/65535)*(maxM-minM)",
                source="AWS Terrain Tiles (terrarium), z15", attribution="Terrain: AWS Open Data / Mapzen")
    print(f"[dem] elevation {hmin:.0f}..{hmax:.0f} m  wrote {dst} ~{os.path.getsize(dst)/1e3:.0f} KB")

    # a coarse JSON contour-friendly sample for quick checks / tests
    small = [[round(grid[j * H // 64][i * W // 64], 1) for i in range(64)] for j in range(64)]
    with open(os.path.join(OUT, "terrain", "preview.json"), "w") as f:
        json.dump(dict(bbox=BBOX, grid=64, minM=round(hmin, 2), maxM=round(hmax, 2), samples=small), f)
    return meta


def write_heightfield(dm):
    """Re-sample the DEM onto the target grid as little-endian float32 (exact, no PNG)."""
    import numpy as np
    z = DEM_ZOOM
    W, H = DEM_GRID
    x0f, y0f = deg2num(BBOX["north"], BBOX["west"], z)
    tx0, ty0 = int(math.floor(x0f)), int(math.floor(y0f))
    tiles = {}
    for ty in range(ty0, ty0 + (H * 4 // 256) + 2):
        for tx in range(tx0, tx0 + (W * 4 // 256) + 2):
            try:
                data = fetch(DEM_URL.format(z=z, x=tx, y=ty), f"dem_{z}_{tx}_{ty}.png")
            except Exception:
                continue
            tiles[(tx, ty)] = terrarium_h(Image.open(io.BytesIO(data)).convert("RGB"))

    def sample(lat, lon):
        mx, my = deg2num(lat, lon, z)
        fx, fy = mx - math.floor(mx), my - math.floor(my)
        key = (int(math.floor(mx)), int(math.floor(my)))
        t = tiles.get(key)
        if t is None:
            return None
        px = min(255, max(0, int(fx * 256)))
        py = min(255, max(0, int(fy * 256)))
        v = t.load()[px, py]
        return v if 0 <= v <= 9000 else None

    grid = np.full((H, W), np.nan, dtype=np.float64)
    for j in range(H):
        lat = BBOX["north"] + (BBOX["south"] - BBOX["north"]) * (j / (H - 1))
        for i in range(W):
            lon = BBOX["west"] + (BBOX["east"] - BBOX["west"]) * (i / (W - 1))
            v = sample(lat, lon)
            if v is not None:
                grid[j, i] = v
    valid_before = int(np.isfinite(grid).sum())
    g = grid.copy()
    for _ in range(400):
        if not np.isnan(g).any():
            break
        pad = np.pad(g, 1, mode="edge")
        st = np.stack([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:],
                       pad[:-2, :-2], pad[:-2, 2:], pad[2:, :-2], pad[2:, 2:]])
        with np.errstate(invalid="ignore"):
            m = np.nanmean(st, axis=0)
        fill = np.isnan(g) & ~np.isnan(m)
        g[fill] = m[fill]
    g = np.where(np.isnan(g), float(np.nanmean(g)), g)
    os.makedirs(os.path.join(OUT, "terrain"), exist_ok=True)
    g.astype("<f4").tofile(os.path.join(OUT, "terrain", "height.f32"))
    np.save(os.path.join(HERE, "terrain_grid.npy"), g)
    png = Image.new("I;16", (W, H))
    px = png.load()
    lo, hi = float(g.min()), float(g.max())
    for j in range(H):
        for i in range(W):
            px[i, j] = int(round((g[j, i] - lo) / (hi - lo) * 65535.0))
    png.save(os.path.join(OUT, "terrain", "height.png"), "PNG", optimize=True)
    import json as _json
    meta = _json.load(open(os.path.join(OUT, "basemap.meta.json")))
    meta["terrain"].update(dict(minM=round(lo, 2), maxM=round(hi, 2),
                                nodata_policy=f"terrarium invalid pixels masked + nearest-neighbour inpainted "
                                              f"({valid_before}/{W*H} cells valid before inpainting)"))
    _json.dump(meta, open(os.path.join(OUT, "basemap.meta.json"), "w"), indent=2)
    print(f"[dem] float32 grid {W}x{H} written, {lo:.0f}-{hi:.0f} m")


def write_generated_ts(dm, im):
    import json as _json
    meta = _json.load(open(os.path.join(OUT, "basemap.meta.json")))
    src = f'''/**
 * basemap.generated.ts — WRITTEN BY tools/bake_tiles.py. Do not edit by hand.
 *
 * Baked basemap extents. The app imports these synchronously so the scene origin and the
 * imagery extents can never drift apart.
 * Generated: {meta.get("generated", "unknown")}
 */
export const BASEMAP_META = {{
  bbox: {{ west: {meta["bbox"]["west"]}, south: {meta["bbox"]["south"]}, east: {meta["bbox"]["east"]}, north: {meta["bbox"]["north"]} }},
  imagery: {{
    zoom: {meta["imagery"]["zoom"]},
    width: {meta["imagery"]["width"]},
    height: {meta["imagery"]["height"]},
    mpp: {round(meta["imagery"]["mpp"], 4)},
    attribution: {_json.dumps(meta["imagery"]["attribution"])},
  }},
  terrain: {{
    grid: [{meta["terrain"]["grid"][0]}, {meta["terrain"]["grid"][1]}],
    minM: {meta["terrain"]["minM"]},
    maxM: {meta["terrain"]["maxM"]},
    source: {_json.dumps(meta["terrain"]["source"])},
    nodataPolicy: {_json.dumps(meta["terrain"].get("nodata_policy", ""))},
  }},
}} as const;
'''
    dst = os.path.abspath(os.path.join(HERE, "..", "src", "config", "basemap.generated.ts"))
    open(dst, "w").write(src)
    print("[ts] src/config/basemap.generated.ts written")


if __name__ == "__main__":
    im = bake_imagery()
    dm = bake_dem()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "basemap.meta.json"), "w") as f:
        json.dump(dict(imagery=im, terrain=dm, bbox=BBOX,
                       generated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())), f, indent=2)
    # emit the raw float32 heightfield the app actually samples, plus typed constants
    write_heightfield(dm)
    write_generated_ts(dm, im)
    print("[done] basemap.meta.json + height.f32 + src/config/basemap.generated.ts written")
