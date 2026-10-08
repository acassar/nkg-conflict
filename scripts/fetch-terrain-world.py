#!/usr/bin/env python3
"""
Relief et occupation du sol du monde entier, agrégés sur la grille mondiale du jeu (vectorisé, parallèle).

Sources :
- Altitude : tuiles « terrarium » d'AWS Terrain Tiles.
- Occupation du sol : ESA WorldCover 2021 v200 (CC BY 4.0), COG publics sur AWS, lus via leurs aperçus.

Usage : python3 scripts/fetch-terrain-world.py <lon0> <lat0> <lon1> <lat1> <cellule°> <sortie.bin.gz> [zoom]
Sortie (gzip, little-endian, ligne 0 = sud) : int16 altitude moyenne, int16 dénivelé,
uint8 % de forêt, uint8 % de zones humides — chaque tableau de largeur × hauteur cellules.
"""
import gzip
import io
import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORLDCOVER = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{ns}{lat:02d}{ew}{lon:03d}_Map.tif"
)
ELEV_SAMPLES = 3  # points d'altitude par cellule et par axe
WC_SAMPLES = 5  # pixels WorldCover par cellule et par axe
WC_TILE_DEG = 3
WC_TREE = 10
WC_WETLAND = 90
THREADS = 24


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def mercator_y(lat, n):
    s = np.sin(np.radians(lat))
    return (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def fetch_terrarium(key):
    z, x, y = key
    url = TERRARIUM.format(z=z, x=x, y=y)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nkg-conflict-terrain/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                rgb = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB"), dtype=np.float32)
            return key, rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                log(f"altitude: échec {key}: {e}")
    return key, None


def elevation(lon0, lat0, lon1, lat1, cell, zoom):
    """Altitude échantillonnée à cell/ELEV_SAMPLES, ligne 0 = sud."""
    w = round((lon1 - lon0) / cell) * ELEV_SAMPLES
    h = round((lat1 - lat0) / cell) * ELEV_SAMPLES
    step = cell / ELEV_SAMPLES
    lons = lon0 + (np.arange(w) + 0.5) * step
    lats = lat0 + (np.arange(h) + 0.5) * step
    n = 2**zoom
    fx = (lons + 180) / 360 * n
    fy = mercator_y(lats, n)
    tx, ty = np.floor(fx).astype(int) % n, np.clip(np.floor(fy).astype(int), 0, n - 1)
    px = np.clip(((fx - np.floor(fx)) * 256).astype(int), 0, 255)
    py = np.clip(((fy - np.floor(fy)) * 256).astype(int), 0, 255)
    keys = [(zoom, x, y) for y in np.unique(ty) for x in np.unique(tx)]
    log(f"altitude : {len(keys)} tuiles")
    out = np.zeros((h, w), dtype=np.float32)
    failures = 0
    with ThreadPoolExecutor(THREADS) as pool:
        for (z, x, y), tile in pool.map(fetch_terrarium, keys):
            if tile is None:
                failures += 1
                continue
            rows = np.nonzero(ty == y)[0]
            cols = np.nonzero(tx == x)[0]
            if len(rows) and len(cols):
                out[np.ix_(rows, cols)] = tile[np.ix_(py[rows], px[cols])]
    return out, failures


def read_wc_tile(args):
    tlat, tlon, n = args
    import rasterio
    from rasterio.enums import Resampling

    url = WORLDCOVER.format(
        ns="N" if tlat >= 0 else "S", lat=abs(tlat), ew="E" if tlon >= 0 else "W", lon=abs(tlon)
    )
    try:
        with rasterio.open(url) as src:
            return tlat, tlon, src.read(1, out_shape=(n, n), resampling=Resampling.nearest)
    except Exception:  # noqa: BLE001  (pas de tuile en pleine mer)
        return tlat, tlon, None


def worldcover(lon0, lat0, lon1, lat1, cell):
    """Mosaïque WorldCover à cell/WC_SAMPLES, ligne 0 = nord."""
    res = cell / WC_SAMPLES
    w = round((lon1 - lon0) / res)
    h = round((lat1 - lat0) / res)
    mosaic = np.zeros((h, w), dtype=np.uint8)
    n = round(WC_TILE_DEG / res)
    tiles = [
        (tlat, tlon, n)
        for tlat in range(math.floor(lat0 / 3) * 3, math.ceil(lat1), 3)
        for tlon in range(math.floor(lon0 / 3) * 3, math.ceil(lon1), 3)
    ]
    log(f"worldcover : {len(tiles)} tuiles candidates")
    found = 0
    with ThreadPoolExecutor(THREADS) as pool:
        for k, (tlat, tlon, tile) in enumerate(pool.map(read_wc_tile, tiles)):
            if k % 500 == 0:
                log(f"worldcover : {k}/{len(tiles)}")
            if tile is None:
                continue
            found += 1
            row0 = round((lat1 - (tlat + WC_TILE_DEG)) / res)
            col0 = round((tlon - lon0) / res)
            r0, c0 = max(0, row0), max(0, col0)
            r1, c1 = min(h, row0 + n), min(w, col0 + n)
            if r1 > r0 and c1 > c0:
                mosaic[r0:r1, c0:c1] = tile[r0 - row0 : r1 - row0, c0 - col0 : c1 - col0]
    return mosaic, found


def main():
    lon0, lat0, lon1, lat1, cell = map(float, sys.argv[1:6])
    out = sys.argv[6]
    zoom = int(sys.argv[7]) if len(sys.argv) > 7 else 5
    W = round((lon1 - lon0) / cell)
    H = round((lat1 - lat0) / cell)

    elev, elev_failures = elevation(lon0, lat0, lon1, lat1, cell, zoom)
    blocks = elev.reshape(H, ELEV_SAMPLES, W, ELEV_SAMPLES)
    mean = blocks.mean(axis=(1, 3))
    relief = blocks.max(axis=(1, 3)) - blocks.min(axis=(1, 3))

    cover, cover_tiles = worldcover(lon0, lat0, lon1, lat1, cell)
    cover = cover[::-1]  # ligne 0 = sud, comme la grille du jeu
    cb = cover.reshape(H, WC_SAMPLES, W, WC_SAMPLES)
    seen = (cb > 0).sum(axis=(1, 3))
    safe = np.maximum(seen, 1)
    forest = np.where(seen > 0, 100 * (cb == WC_TREE).sum(axis=(1, 3)) / safe, 0)
    wetland = np.where(seen > 0, 100 * (cb == WC_WETLAND).sum(axis=(1, 3)) / safe, 0)

    with gzip.open(out, "wb") as f:
        f.write(np.clip(np.round(mean), -32768, 32767).astype("<i2").tobytes())
        f.write(np.clip(np.round(relief), 0, 32767).astype("<i2").tobytes())
        f.write(np.round(forest).astype(np.uint8).tobytes())
        f.write(np.round(wetland).astype(np.uint8).tobytes())
    print(
        json.dumps(
            {
                "bbox": [lon0, lat0, lon1, lat1],
                "cell": cell,
                "width": W,
                "height": H,
                "echecs_altitude": elev_failures,
                "tuiles_worldcover": cover_tiles,
                "foret_moyenne_pct": round(float(forest.mean()), 2),
                "altitude_max": int(mean.max()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
