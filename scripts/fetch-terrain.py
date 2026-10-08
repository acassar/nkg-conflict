#!/usr/bin/env python3
"""
Télécharge le relief et l'occupation du sol du théâtre, et les agrège sur la grille du jeu.

Sources :
- Altitude : tuiles « terrarium » d'AWS Terrain Tiles (sources ouvertes), zoom 7 (~1 km).
- Occupation du sol : ESA WorldCover 2021 v200 (CC BY 4.0), fichiers COG publics sur AWS,
  lus en basse résolution grâce à leurs aperçus internes (quelques Mo au lieu de plusieurs Go).

Usage : python3 scripts/fetch-terrain.py <lon0> <lat0> <lon1> <lat1> <cellule°> <sortie.json.gz>
Sortie : pour chaque cellule (ligne 0 = sud), altitude moyenne, dénivelé (max - min),
part de forêt et part de zones humides (en %). La classification est faite par build-theater.mjs.
"""
import gzip
import io
import json
import math
import sys
import urllib.request

import numpy as np
from PIL import Image

ZOOM = 7
SAMPLES = 5  # points d'altitude échantillonnés par cellule et par axe

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORLDCOVER = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{ns}{lat:02d}{ew}{lon:03d}_Map.tif"
)
WC_TILE_DEG = 3
WC_RES = 0.01  # degrés par pixel lu (5 × 5 par cellule de 0,05°)
WC_TREE = 10
WC_WETLAND = 90


def tile_xy(lon, lat, z):
    n = 2**z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "nkg-conflict-terrain/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


class TileSource:
    """Tuiles web Mercator, chargées à la demande et gardées en mémoire."""

    def __init__(self, template, name):
        self.template = template
        self.name = name
        self.cache = {}
        self.failures = 0

    def pixel(self, lon, lat):
        fx, fy = tile_xy(lon, lat, ZOOM)
        tx, ty = int(fx), int(fy)
        key = (tx, ty)
        if key not in self.cache:
            try:
                self.cache[key] = fetch(self.template.format(z=ZOOM, x=tx, y=ty))
            except Exception as e:  # noqa: BLE001
                self.failures += 1
                print(f"{self.name}: échec tuile {key}: {e}", file=sys.stderr)
                self.cache[key] = None
        img = self.cache[key]
        if img is None:
            return None
        w, h = img.size
        px = min(w - 1, int((fx - tx) * w))
        py = min(h - 1, int((fy - ty) * h))
        return img.getpixel((px, py))


def read_worldcover(lon0, lat0, lon1, lat1):
    """Mosaïque WorldCover sur l'emprise, à WC_RES degrés par pixel, ligne 0 = nord. 0 = pas de donnée."""
    import rasterio
    from rasterio.enums import Resampling

    width = round((lon1 - lon0) / WC_RES)
    height = round((lat1 - lat0) / WC_RES)
    mosaic = np.zeros((height, width), dtype=np.uint8)
    failures = 0
    n = round(WC_TILE_DEG / WC_RES)
    lat_start = math.floor(lat0 / WC_TILE_DEG) * WC_TILE_DEG
    lon_start = math.floor(lon0 / WC_TILE_DEG) * WC_TILE_DEG
    for tlat in range(lat_start, math.ceil(lat1), WC_TILE_DEG):
        for tlon in range(lon_start, math.ceil(lon1), WC_TILE_DEG):
            url = WORLDCOVER.format(
                ns="N" if tlat >= 0 else "S",
                lat=abs(tlat),
                ew="E" if tlon >= 0 else "W",
                lon=abs(tlon),
            )
            try:
                with rasterio.open(url) as src:
                    tile = src.read(1, out_shape=(n, n), resampling=Resampling.nearest)
            except Exception as e:  # noqa: BLE001  (les tuiles en pleine mer n'existent pas)
                failures += 1
                print(f"worldcover: {tlat},{tlon}: {e}", file=sys.stderr)
                continue
            # Collage de la tuile (nord en haut) dans la mosaïque.
            row0 = round((lat1 - (tlat + WC_TILE_DEG)) / WC_RES)
            col0 = round((tlon - lon0) / WC_RES)
            r0, c0 = max(0, row0), max(0, col0)
            r1, c1 = min(height, row0 + n), min(width, col0 + n)
            if r1 > r0 and c1 > c0:
                mosaic[r0:r1, c0:c1] = tile[r0 - row0 : r1 - row0, c0 - col0 : c1 - col0]
            print(f"worldcover: {tlat},{tlon} ok", file=sys.stderr)
    return mosaic, failures


def main():
    lon0, lat0, lon1, lat1, cell = map(float, sys.argv[1:6])
    out = sys.argv[6]
    width = round((lon1 - lon0) / cell)
    height = round((lat1 - lat0) / cell)
    elev = TileSource(TERRARIUM, "altitude")
    cover, cover_failures = read_worldcover(lon0, lat0, lon1, lat1)
    per = round(cell / WC_RES)
    cover_h = cover.shape[0]

    mean, relief, forest, wetland = [], [], [], []
    for y in range(height):
        for x in range(width):
            heights = []
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    lon = lon0 + (x + (sx + 0.5) / SAMPLES) * cell
                    lat = lat0 + (y + (sy + 0.5) / SAMPLES) * cell
                    p = elev.pixel(lon, lat)
                    if p is not None:
                        heights.append(p[0] * 256 + p[1] + p[2] / 256 - 32768)
            mean.append(round(sum(heights) / len(heights)) if heights else 0)
            relief.append(round(max(heights) - min(heights)) if heights else 0)
            # Occupation du sol : le bloc de per × per pixels de la cellule (mosaïque nord en haut).
            block = cover[cover_h - (y + 1) * per : cover_h - y * per, x * per : (x + 1) * per]
            seen = int((block > 0).sum())
            forest.append(round(100 * int((block == WC_TREE).sum()) / seen) if seen else 0)
            wetland.append(round(100 * int((block == WC_WETLAND).sum()) / seen) if seen else 0)
        if y % 20 == 0:
            print(f"ligne {y + 1}/{height}", file=sys.stderr)

    data = {
        "bbox": [lon0, lat0, lon1, lat1],
        "cell": cell,
        "width": width,
        "height": height,
        "sources": {
            "altitude": "AWS Terrain Tiles (terrarium)",
            "occupation": "ESA WorldCover 2021 v200, CC BY 4.0",
        },
        "failures": {"altitude": elev.failures, "worldcover": cover_failures},
        "meanElevation": mean,
        "relief": relief,
        "forestPct": forest,
        "wetlandPct": wetland,
    }
    with gzip.open(out, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(
        json.dumps(
            {
                "cellules": width * height,
                "tuiles_altitude": len(elev.cache),
                "echecs": data["failures"],
                "foret_moyenne_pct": round(sum(forest) / len(forest), 1),
                "zones_humides_moyenne_pct": round(sum(wetland) / len(wetland), 2),
                "altitude_max": max(mean),
                "denivele_max": max(relief),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
