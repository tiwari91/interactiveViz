#!/usr/bin/env python3
"""Fetch monthly reservoir storage (CDEC sensor 15, acre-feet) for every
reservoir in data/reservoir_filtered_data.csv and write
data/reservoir_storage_monthly.csv (columns: ID, date, storage_af).

Also fetch daily mean river flow (sensor 41, cfs) for the river stations in
data/reservoir_dis_link.csv, average it per month and write
data/river_flow_monthly.csv (columns: StationID, date, flow_cfs). Stations
without daily flow on CDEC are simply absent from that file.

Source: California Data Exchange Center, https://cdec.water.ca.gov
Usage:  python3 scripts/fetch_cdec.py [start YYYY-MM-DD] [end YYYY-MM-DD]
"""
import csv
import io
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START = sys.argv[1] if len(sys.argv) > 1 else "2011-10-01"
END = sys.argv[2] if len(sys.argv) > 2 else "2017-09-30"
URL = ("https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet"
       "?Stations={ids}&SensorNums={sensor}&dur_code={dur}&Start={start}&End={end}")


def fetch(ids, sensor, dur="M"):
    url = URL.format(ids=",".join(ids), sensor=sensor, dur=dur, start=START, end=END)
    with urllib.request.urlopen(url, timeout=60) as resp:
        return list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))


def main():
    with open(ROOT / "data/reservoir_filtered_data.csv", newline="") as fh:
        ids = sorted({row["ID"] for row in csv.DictReader(fh)})
    rows = []
    for i in range(0, len(ids), 8):
        chunk = ids[i:i + 8]
        for rec in fetch(chunk, 15):
            value = rec["VALUE"].strip()
            if not value or value in ("---", "-9999"):
                continue
            stamp = rec["DATE TIME"][:8]
            rows.append((rec["STATION_ID"], f"{stamp[:4]}-{stamp[4:6]}", round(float(value))))
        time.sleep(0.5)
    rows.sort()
    out = ROOT / "data/reservoir_storage_monthly.csv"
    with open(out, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["ID", "date", "storage_af"])
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows for {len({r[0] for r in rows})}/{len(ids)} reservoirs -> {out}")
    fetch_flows()


def fetch_flows():
    with open(ROOT / "data/reservoir_dis_link.csv", newline="") as fh:
        stations = sorted({row["StationID"] for row in csv.DictReader(fh)})
    sums = {}
    for rec in fetch(stations, 41, "D"):
        value = rec["VALUE"].strip()
        try:
            flow = float(value)
        except ValueError:
            continue
        if flow < 0:
            continue
        stamp = rec["DATE TIME"][:8]
        key = (rec["STATION_ID"], f"{stamp[:4]}-{stamp[4:6]}")
        total, count = sums.get(key, (0.0, 0))
        sums[key] = (total + flow, count + 1)
    out = ROOT / "data/river_flow_monthly.csv"
    with open(out, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["StationID", "date", "flow_cfs"])
        for (station, month), (total, count) in sorted(sums.items()):
            writer.writerow([station, month, round(total / count, 1)])
    print(f"wrote {len(sums)} rows for {len({k[0] for k in sums})}/{len(stations)} river stations -> {out}")


if __name__ == "__main__":
    main()
