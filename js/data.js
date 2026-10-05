// Loads and joins the CSV/TopoJSON inputs into plain objects the views share.
const d3 = window.d3;

const ACRONYM = /^(USBR|USACE|PCWA|PG&E)$/;
// Gaps in a reservoir's monthly record: interior gaps up to this many months are
// interpolated linearly, and a record that stops up to this many months before
// the end is carried forward. Longer gaps stay empty.
const MAX_GAP = 3;
const MAX_CARRY = 2;

export function displayName(raw) {
	return raw
		.toLowerCase()
		.replace(/\b[\w&]+/g, (w) => (ACRONYM.test(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
		.replace(/\bLk\b/, "Lake")
		.replace(/ R$/, " River")
		.replace(" - ", " – ");
}

function monthIndex(months) {
	return new Map(months.map((m, i) => [ m, i ]));
}

// Fill short gaps in place; returns how each filled month was made.
function fillGaps(series) {
	const filled = new Array(series.length).fill(null);
	const known = series.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
	for (let k = 1; k < known.length; k++) {
		const a = known[k - 1];
		const b = known[k];
		if (b - a <= 1 || b - a - 1 > MAX_GAP) continue;
		for (let i = a + 1; i < b; i++) {
			series[i] = Math.round(series[a] + (series[b] - series[a]) * (i - a) / (b - a));
			filled[i] = "interpolated";
		}
	}
	const last = known[known.length - 1];
	if (last !== undefined && series.length - 1 - last <= MAX_CARRY) {
		for (let i = last + 1; i < series.length; i++) {
			series[i] = series[last];
			filled[i] = "carried";
		}
	}
	return filled;
}

export async function loadData(base = "data/") {
	const [ topo, sites, meta, links, storage, flows, droughts ] = await Promise.all([
		d3.json(`${base}ca.json`),
		d3.csv(`${base}reservoir_filtered_data.csv`),
		d3.csv(`${base}reservoir_meta.csv`),
		d3.csv(`${base}reservoir_dis_link.csv`),
		d3.csv(`${base}reservoir_storage_monthly.csv`),
		d3.csv(`${base}river_flow_monthly.csv`),
		d3.csv(`${base}drought_periods.csv`),
	]);

	const months = Array.from(new Set(storage.map((d) => d.date))).sort();
	const idx = monthIndex(months);
	const parseMonth = d3.timeParse("%Y-%m");
	const dates = months.map(parseMonth);
	const metaById = new Map(meta.map((m) => [ m.ID, m ]));

	// Reservoirs: the source CSV lists Clear Lake twice, so key by ID.
	const reservoirs = [];
	const byId = new Map();
	for (const row of sites) {
		if (byId.has(row.ID)) continue;
		const m = metaById.get(row.ID);
		const r = {
			id: row.ID,
			name: displayName(row.Station),
			county: displayName(row.County),
			elev: +row.Elev,
			lat: +row.Latitude,
			lon: +row.Longitude,
			yearBuilt: +row.Year_Built,
			// Capacities from the 2016 dataset, replaced by CDEC's where they were revised.
			capacity: m?.capacity_af ? +m.capacity_af : +row.Capacity,
			capacity2016: +row.Capacity,
			capacitySource: m?.capacity_source || "2016 dataset",
			purpose: m?.purpose || "storage",
			note: m?.note || "",
			series: new Array(months.length).fill(null),
			flags: new Array(months.length).fill(null),
		};
		r.floodControl = r.purpose === "flood-control";
		byId.set(r.id, r);
		reservoirs.push(r);
	}
	let lastRevised = -1;
	for (const row of storage) {
		const r = byId.get(row.ID);
		const i = idx.get(row.date);
		if (!r || i === undefined) continue;
		r.series[i] = +row.storage_af;
		r.flags[i] = row.flag || "";
		if (row.flag === "r") lastRevised = Math.max(lastRevised, i);
	}
	for (const r of reservoirs) {
		r.hasData = r.series.some((v) => v !== null);
		r.filled = fillGaps(r.series);
	}

	// CDEC data stay provisional until operators revise them, which the big
	// reservoirs do once a water year closes: months after the last revised value are provisional.
	const provisional = months.map((_, i) => i > lastRevised);

	// Drought emergency periods from the governor's proclamations (see README).
	const droughtPeriods = droughts.map((d) => ({
		start: d3.timeParse("%Y-%m-%d")(d.start),
		end: d3.timeParse("%Y-%m-%d")(d.end),
		label: d.label,
		note: d.note,
	}));

	// River gauges and their monthly mean flow, where CDEC has it.
	const flowSeries = d3.group(flows, (d) => d.StationID);
	const gauges = new Map();
	const linkList = [];
	const seen = new Set();
	for (const row of links) {
		// Join on the reservoir ID; one row's Station name is mislabeled in the source CSV.
		const r = byId.get(row.ID);
		if (!r) continue;
		const key = `${row.StationID}>${r.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!gauges.has(row.StationID)) {
			const series = new Array(months.length).fill(null);
			for (const f of flowSeries.get(row.StationID) ?? []) {
				const i = idx.get(f.date);
				if (i !== undefined) series[i] = +f.flow_cfs;
			}
			gauges.set(row.StationID, {
				id: row.StationID,
				basin: displayName(row.RiverBasin),
				county: displayName(row.County),
				lat: +row.Source_Latitude,
				lon: +row.Source_Longitude,
				flow: series.some((v) => v !== null) ? series : null,
			});
		}
		linkList.push({ key, gauge: gauges.get(row.StationID), reservoir: r });
	}

	// Totals over the tracked reservoirs: storage reservoirs with CDEC data.
	// Flood-control basins are left out; they are meant to be empty.
	const tracked = reservoirs.filter((r) => r.hasData && !r.floodControl);
	const floodControl = reservoirs.filter((r) => r.floodControl);
	const noData = reservoirs.filter((r) => !r.hasData);
	const totals = months.map((_, i) => {
		let storageSum = 0;
		let capacitySum = 0;
		let low = 0;
		let reporting = 0;
		const filled = [];
		for (const r of tracked) {
			const v = r.series[i];
			if (v === null) continue;
			reporting += 1;
			storageSum += v;
			capacitySum += r.capacity;
			if (v / r.capacity < 0.4) low += 1;
			if (r.filled[i]) filled.push(r);
		}
		return { storage: storageSum, capacity: capacitySum, pct: capacitySum ? storageSum / capacitySum : 0, low, reporting, filled };
	});

	const counties = topojson.feature(topo, topo.objects.counties);
	const outline = topojson.merge(topo, topo.objects.counties.geometries);
	const countyMesh = topojson.mesh(topo, topo.objects.counties, (a, b) => a !== b);

	return {
		months, dates, reservoirs, byId, tracked, floodControl, noData, provisional, droughtPeriods,
		gauges: [ ...gauges.values() ], links: linkList, totals, counties, outline, countyMesh,
	};
}

export function storageAt(r, i) {
	const v = r.series[i];
	return v === null ? null : v;
}

export function pctAt(r, i) {
	const v = r.series[i];
	return v === null ? null : v / r.capacity;
}

export function flowAt(gauge, i) {
	return gauge.flow ? gauge.flow[i] : null;
}

// Short note on where this month's value came from, or "" for an ordinary reading.
export function valueNote(r, i) {
	if (r.filled[i] === "interpolated") return "No CDEC report this month; interpolated from the months either side.";
	if (r.filled[i] === "carried") return "Not reported yet; last month's value carried forward.";
	if (r.flags[i] === "e") return "CDEC flags this value as estimated.";
	return "";
}
