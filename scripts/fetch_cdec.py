#!/usr/bin/env python3
"""Fetch monthly reservoir storage (CDEC sensor 15, duration M, acre-feet) for
every reservoir in data/reservoir_filtered_data.csv and write
data/reservoir_storage_monthly.csv (columns: ID, date, storage_af, flag).

A monthly ("M") storage value is the reservoir's END-OF-MONTH storage: CDEC
stamps it with the first day of the month and its OBS DATE is the month's last
day. `flag` is CDEC's DATA_FLAG, kept as is: "r" = revised by the operator,
"e" = estimated, blank = as reported (provisional until revised).

Also fetch daily mean river flow (sensor 41, cfs) for the river stations in
data/reservoir_dis_link.csv, average it per month and write
data/river_flow_monthly.csv (columns: StationID, date, flow_cfs, days).
Stations without daily flow on CDEC are simply absent from that file.

The end date defaults to the last day of the previous calendar month. Trailing
months that fewer than 80% of the reporting reservoirs have filed yet are
dropped, so the series ends on the latest complete month.

Source: California Data Exchange Center, https://cdec.water.ca.gov
Usage:  python3 scripts/fetch_cdec.py [start YYYY-MM-DD] [end YYYY-MM-DD]
"""
import csv
import datetime as dt
import io
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_first = dt.date.today().replace(day=1)
START = sys.argv[1] if len(sys.argv) > 1 else "2011-10-01"
END = sys.argv[2] if len(sys.argv) > 2 else (_first - dt.timedelta(days=1)).isoformat()
URL = ("https://cdec.water.ca.gov/dynamicapp/req/CSVDataServlet"
       "?Stations={ids}&SensorNums={sensor}&dur_code={dur}&Start={start}&End={end}")
COMPLETE = 0.8


def fetch(ids, sensor, dur="M"):
    url = URL.format(ids=",".join(ids), sensor=sensor, dur=dur, start=START, end=END)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        except OSError:
            if attempt == 2:
                raise
            time.sleep(3)


def main():
    with open(ROOT / "data/reservoir_filtered_data.csv", newline="") as fh:
        ids = sorted({row["ID"] for row in csv.DictReader(fh)})
    rows = []
    for i in range(0, len(ids), 6):
        chunk = ids[i:i + 6]
        for rec in fetch(chunk, 15):
            value = rec["VALUE"].strip()
            if not value or value in ("---", "-9999"):
                continue
            stamp = rec["DATE TIME"][:8]
            flag = (rec.get("DATA_FLAG") or "").strip()
            rows.append((rec["STATION_ID"], f"{stamp[:4]}-{stamp[4:6]}", round(float(value)), flag))
        time.sleep(0.5)

    # Drop trailing months that most reservoirs have not filed yet.
    stations = {r[0] for r in rows}
    per_month = {}
    for r in rows:
        per_month.setdefault(r[1], set()).add(r[0])
    months = sorted(per_month)
    while months and len(per_month[months[-1]]) < COMPLETE * len(stations):
        months.pop()
    last = months[-1]
    rows = sorted(r for r in rows if r[1] <= last)

    out = ROOT / "data/reservoir_storage_monthly.csv"
    with open(out, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["ID", "date", "storage_af", "flag"])
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows for {len(stations)}/{len(ids)} reservoirs, {months[0]}..{last} -> {out}")
    missing = sorted(set(ids) - stations)
    if missing:
        print("no storage on CDEC:", ", ".join(missing))
    fetch_flows(last)


def fetch_flows(last):
    with open(ROOT / "data/reservoir_dis_link.csv", newline="") as fh:
        stations = sorted({row["StationID"] for row in csv.DictReader(fh)})
    sums = {}
    for station in stations:
        for rec in fetch([station], 41, "D"):
            try:
                flow = float(rec["VALUE"].strip())
            except ValueError:
                continue
            if flow < 0:
                continue
            stamp = rec["DATE TIME"][:8]
            key = (rec["STATION_ID"], f"{stamp[:4]}-{stamp[4:6]}")
            if key[1] > last:
                continue
            total, count = sums.get(key, (0.0, 0))
            sums[key] = (total + flow, count + 1)
        time.sleep(0.5)
    out = ROOT / "data/river_flow_monthly.csv"
    with open(out, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["StationID", "date", "flow_cfs", "days"])
        for (station, month), (total, count) in sorted(sums.items()):
            writer.writerow([station, month, round(total / count, 1), count])
    reporting = sorted({k[0] for k in sums})
    print(f"wrote {len(sums)} rows for {len(reporting)}/{len(stations)} river stations -> {out}")
    for s in reporting:
        months = sorted(m for (st, m) in sums if st == s)
        print(f"  {s}: {months[0]}..{months[-1]} ({len(months)} months)")


if __name__ == "__main__":
    main()
