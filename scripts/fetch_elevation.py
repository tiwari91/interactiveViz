#!/usr/bin/env python3
"""Fetch a coarse elevation grid for California from NOAA ETOPO1 (ERDDAP
dataset etopo180, public domain) and write compact binaries for the 3D view.

Writes:
  data/elevation-1m.bin, data/elevation-2m.bin   1 and 2 arc-minute grids over the state
  data/elevation-surround.bin                    5 arc-minute grid of the wider region
  data/elevation.json                            grid metadata

Each grid is int16 metres, rows north->south, cols west->east, stored compressed-friendly
("grad-planes-v1"): sea floor deeper than FLOOR metres is clamped (the ocean surface hides
it), each value is replaced by its residual from a left + up - upleft predictor, and the
residuals' low bytes are written before their high bytes. Smooth relief then gzips to about
half the raw size. js/three/world.js decodes it.

Re-encode existing raw grids without fetching: python3 scripts/fetch_elevation.py --encode-raw

Usage: python3 scripts/fetch_elevation.py
"""
import array
import csv
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "https://upwell.pfeg.noaa.gov/erddap/griddap/etopo180.csv"
LAT = (32.4, 42.1)
LON = (-124.6, -114.0)
# Wider, coarser grid drawn around the detailed one so the edges sit in the haze.
SURROUND = {"lat": (28.0, 46.5), "lon": (-131.0, -107.5), "stride": 5}
FLOOR = -300
ENCODING = "grad-planes-v1"


def encode(grid, rows, cols):
    """grad-planes-v1: clamp the deep sea floor, predictor residuals, low then high bytes."""
    a = [max(FLOOR, v) for v in grid]
    lo = bytearray(len(a))
    hi = bytearray(len(a))
    for r in range(rows):
        for c in range(cols):
            i = r * cols + c
            if r and c:
                pred = a[i - 1] + a[i - cols] - a[i - cols - 1]
            elif c:
                pred = a[i - 1]
            elif r:
                pred = a[i - cols]
            else:
                pred = 0
            res = (a[i] - pred) & 0xFFFF
            lo[i] = res & 0xFF
            hi[i] = res >> 8
    return bytes(lo + hi)


def get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as resp:
                return resp.read().decode("utf-8")
        except Exception as exc:  # flaky chunked responses on large requests
            if attempt == tries - 1:
                raise
            print(f"retrying ({exc.__class__.__name__})")
            time.sleep(3)


def fetch(stride, lat_range=LAT, lon_range=LON):
    # Request in latitude bands; one big response tends to get cut off.
    rows = {}
    bands = 6
    step = (lat_range[1] - lat_range[0]) / bands
    for b in range(bands):
        lo_lat = lat_range[0] + b * step
        hi_lat = lat_range[0] + (b + 1) * step
        query = f"?altitude%5B({lo_lat:.4f}):{stride}:({hi_lat:.4f})%5D%5B({lon_range[0]}):{stride}:({lon_range[1]})%5D"
        for r in list(csv.reader(io.StringIO(get(HOST + query))))[2:]:
            rows[(round(float(r[0]), 5), round(float(r[1]), 5))] = r[2]
    rows = [(k[0], k[1], v) for k, v in rows.items()]
    lats = sorted({r[0] for r in rows}, reverse=True)
    lons = sorted({r[1] for r in rows})
    li = {v: i for i, v in enumerate(lats)}
    lo = {v: i for i, v in enumerate(lons)}
    grid = array.array("h", [0]) * (len(lats) * len(lons))
    for lat, lon, alt in rows:
        grid[li[lat] * len(lons) + lo[lon]] = max(-32768, min(32767, int(float(alt))))
    if sys.byteorder != "little":
        grid.byteswap()
    return lats, lons, grid


def main():
    meta = {"source": "NOAA ETOPO1 (etopo180) via ERDDAP, metres", "grids": {}}
    jobs = [(1, LAT, LON, "1m"), (2, LAT, LON, "2m"), (SURROUND["stride"], SURROUND["lat"], SURROUND["lon"], "surround")]
    for stride, lat_range, lon_range, key in jobs:
        lats, lons, grid = fetch(stride, lat_range, lon_range)
        name = f"elevation-{key}.bin"
        (ROOT / "data" / name).write_bytes(encode(grid, len(lats), len(lons)))
        meta["grids"][key] = {
            "file": name,
            "encoding": ENCODING,
            "floor": FLOOR,
            "rows": len(lats),
            "cols": len(lons),
            "north": lats[0],
            "south": lats[-1],
            "west": lons[0],
            "east": lons[-1],
        }
        print(f"{name}: {len(lats)} x {len(lons)}")
    (ROOT / "data/elevation.json").write_text(json.dumps(meta, indent=1))


def encode_raw():
    """Convert raw int16 grids already in data/ to the encoded format, in place."""
    path = ROOT / "data/elevation.json"
    meta = json.loads(path.read_text())
    for g in meta["grids"].values():
        if g.get("encoding"):
            continue
        grid = array.array("h")
        grid.frombytes((ROOT / "data" / g["file"]).read_bytes())
        if sys.byteorder != "little":
            grid.byteswap()
        (ROOT / "data" / g["file"]).write_bytes(encode(grid, g["rows"], g["cols"]))
        g["encoding"] = ENCODING
        g["floor"] = FLOOR
        print(f"{g['file']}: encoded")
    path.write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    encode_raw() if "--encode-raw" in sys.argv else main()
