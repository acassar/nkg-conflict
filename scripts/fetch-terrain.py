#!/usr/bin/env python3
"""
Télécharge le relief et l'occupation du sol du théâtre, et les agrège sur la grille du jeu.

Sources (tuiles web, échelle ~1 km) :
- Altitude : tuiles « terrarium » d'AWS Terrain Tiles (domaine public / sources ouvertes).
- Occupation du sol : ESA WorldCover 2021 (CC BY 4.0), via le service WMTS de Terrascope.

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

from PIL import Image

ZOOM = 7
SAMPLES = 5  # points échantillonnés par cellule et par axe

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORLDCOVER = (
    "https://services.terrascope.be/wmts/v2?layer=WORLDCOVER_2021_MAP&style=&tilematrixset=EPSG:3857"
    "&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/png"
    "&TileMatrix=EPSG:3857:{z}&TileCol={x}&TileRow={y}"
)

# Couleurs officielles des classes WorldCover.
WC_CLASSES = {
    "tree": (0, 100, 0),
    "shrub": (255, 187, 34),
    "grass": (255, 255, 76),
    "crop": (240, 150, 255),
    "built": (250, 0, 0),
    "bare": (180, 180, 180),
    "snow": (240, 240, 240),
    "water": (0, 100, 200),
    "wetland": (0, 150, 160),
    "mangrove": (0, 207, 117),
    "moss": (250, 230, 160),
}


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


def nearest_class(rgb):
    best, best_d = None, 1e9
    for name, c in WC_CLASSES.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, c))
        if d < best_d:
            best, best_d = name, d
    return best


def main():
    lon0, lat0, lon1, lat1, cell = map(float, sys.argv[1:6])
    out = sys.argv[6]
    width = round((lon1 - lon0) / cell)
    height = round((lat1 - lat0) / cell)
    elev = TileSource(TERRARIUM, "altitude")
    cover = TileSource(WORLDCOVER, "worldcover")

    mean, relief, forest, wetland = [], [], [], []
    for y in range(height):
        for x in range(width):
            heights, trees, wet, seen = [], 0, 0, 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    lon = lon0 + (x + (sx + 0.5) / SAMPLES) * cell
                    lat = lat0 + (y + (sy + 0.5) / SAMPLES) * cell
                    p = elev.pixel(lon, lat)
                    if p is not None:
                        heights.append(p[0] * 256 + p[1] + p[2] / 256 - 32768)
                    c = cover.pixel(lon, lat)
                    if c is not None and c != (0, 0, 0):
                        seen += 1
                        cls = nearest_class(c)
                        trees += cls == "tree"
                        wet += cls == "wetland"
            mean.append(round(sum(heights) / len(heights)) if heights else 0)
            relief.append(round(max(heights) - min(heights)) if heights else 0)
            forest.append(round(100 * trees / seen) if seen else 0)
            wetland.append(round(100 * wet / seen) if seen else 0)
        print(f"ligne {y + 1}/{height}", file=sys.stderr) if y % 20 == 0 else None

    data = {
        "bbox": [lon0, lat0, lon1, lat1],
        "cell": cell,
        "width": width,
        "height": height,
        "sources": {
            "altitude": "AWS Terrain Tiles (terrarium)",
            "occupation": "ESA WorldCover 2021, CC BY 4.0",
        },
        "failures": {"altitude": elev.failures, "worldcover": cover.failures},
        "meanElevation": mean,
        "relief": relief,
        "forestPct": forest,
        "wetlandPct": wetland,
    }
    with gzip.open(out, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    land = [v for v in forest]
    print(
        json.dumps(
            {
                "cellules": width * height,
                "tuiles": {"altitude": len(elev.cache), "worldcover": len(cover.cache)},
                "echecs": data["failures"],
                "foret_moyenne_pct": round(sum(land) / len(land), 1),
                "altitude_max": max(mean),
                "denivele_max": max(relief),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
