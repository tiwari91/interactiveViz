#!/usr/bin/env python3
"""Route each gauge -> reservoir link along valleys of the elevation grid
(least-cost path, cost rises with elevation and climbing) so the 3D rivers
follow the terrain instead of cutting across ridges.

Reads data/elevation-2m.bin + data/elevation.json and data/reservoir_dis_link.csv,
writes data/river_paths.json: {"<gauge>><reservoir>": [[lon, lat], ...]}.
"""
import array
import csv
import heapq
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_grid():
    meta = json.loads((ROOT / "data/elevation.json").read_text())["grids"]["2m"]
    grid = array.array("h")
    grid.frombytes((ROOT / "data" / meta["file"]).read_bytes())
    return meta, grid


def main():
    meta, grid = load_grid()
    rows, cols = meta["rows"], meta["cols"]
    dlat = (meta["north"] - meta["south"]) / (rows - 1)
    dlon = (meta["east"] - meta["west"]) / (cols - 1)

    def cell(lon, lat):
        return round((meta["north"] - lat) / dlat), round((lon - meta["west"]) / dlon)

    def elev(r, c):
        return grid[r * cols + c]

    def route(a, b, margin=25):
        (r0, c0), (r1, c1) = a, b
        rmin, rmax = max(0, min(r0, r1) - margin), min(rows - 1, max(r0, r1) + margin)
        cmin, cmax = max(0, min(c0, c1) - margin), min(cols - 1, max(c0, c1) + margin)
        dist = {a: 0.0}
        prev = {}
        heap = [(0.0, a)]
        steps = [(dr, dc, math.hypot(dr, dc)) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
        while heap:
            d, (r, c) = heapq.heappop(heap)
            if (r, c) == b:
                break
            if d > dist[(r, c)]:
                continue
            e0 = elev(r, c)
            for dr, dc, step in steps:
                nr, nc = r + dr, c + dc
                if not (rmin <= nr <= rmax and cmin <= nc <= cmax):
                    continue
                e1 = elev(nr, nc)
                if e1 < -5:
                    cost = step * 60  # avoid the ocean
                else:
                    cost = step * (1 + max(e1, 0) / 250 + max(0, e1 - e0) / 25)
                nd = d + cost
                if nd < dist.get((nr, nc), 1e18):
                    dist[(nr, nc)] = nd
                    prev[(nr, nc)] = (r, c)
                    heapq.heappush(heap, (nd, (nr, nc)))
        path = [b]
        while path[-1] != a:
            path.append(prev[path[-1]])
        return path[::-1]

    out = {}
    with open(ROOT / "data/reservoir_dis_link.csv", newline="") as fh:
        links = list(csv.DictReader(fh))
    for row in links:
        key = f"{row['StationID']}>{row['ID']}"
        if key in out:
            continue
        src = (float(row["Source_Longitude"]), float(row["Source_Latitude"]))
        dst = (float(row["Dest_Lon"]), float(row["Dest_Lat"]))
        cells = route(cell(*src), cell(*dst))
        pts = [src] + [(meta["west"] + c * dlon, meta["north"] - r * dlat) for r, c in cells[1:-1]] + [dst]
        # Light smoothing and thinning keeps the files small and the curves soft.
        smooth = [pts[0]]
        for i in range(1, len(pts) - 1):
            smooth.append(tuple((pts[i - 1][k] + 2 * pts[i][k] + pts[i + 1][k]) / 4 for k in (0, 1)))
        smooth.append(pts[-1])
        thin = smooth[::2] if len(smooth) > 6 else smooth
        if thin[-1] != smooth[-1]:
            thin.append(smooth[-1])
        out[key] = [[round(x, 4), round(y, 4)] for x, y in thin]
    (ROOT / "data/river_paths.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {len(out)} paths")


if __name__ == "__main__":
    main()
