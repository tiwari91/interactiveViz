// Loads and joins the CSV/TopoJSON inputs into plain objects the views share.
const d3 = window.d3;

const ACRONYM = /^(USBR|USACE|PCWA|PG&E)$/;

export function displayName(raw) {
	return raw
		.toLowerCase()
		.replace(/\b[\w&]+/g, (w) => (ACRONYM.test(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
		.replace(/\bLk\b/, "Lake")
		.replace(/ R$/, " River")
		.replace(" - ", " – ");
}

function monthIndex(months) {
	return new Map(months.map((m, i) => [m, i]));
}

export async function loadData(base = "data/") {
	const [topo, sites, links, storage, flows] = await Promise.all([
		d3.json(`${base}ca.json`),
		d3.csv(`${base}reservoir_filtered_data.csv`),
		d3.csv(`${base}reservoir_dis_link.csv`),
		d3.csv(`${base}reservoir_storage_monthly.csv`),
		d3.csv(`${base}river_flow_monthly.csv`),
	]);

	const months = Array.from(new Set(storage.map((d) => d.date))).sort();
	const idx = monthIndex(months);
	const dates = months.map((m) => d3.timeParse("%Y-%m")(m));

	// Reservoirs: the source CSV lists Clear Lake twice, so key by ID.
	const reservoirs = [];
	const byId = new Map();
	for (const row of sites) {
		if (byId.has(row.ID)) continue;
		const r = {
			id: row.ID,
			name: displayName(row.Station),
			county: displayName(row.County),
			elev: +row.Elev,
			lat: +row.Latitude,
			lon: +row.Longitude,
			yearBuilt: +row.Year_Built,
			capacity: +row.Capacity,
			series: new Array(months.length).fill(null),
		};
		byId.set(r.id, r);
		reservoirs.push(r);
	}
	for (const row of storage) {
		const r = byId.get(row.ID);
		const i = idx.get(row.date);
		if (r && i !== undefined) r.series[i] = +row.storage_af;
	}
	for (const r of reservoirs) r.hasData = r.series.some((v) => v !== null);

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

	// Statewide totals over the reservoirs reporting each month.
	const totals = months.map((_, i) => {
		let storageSum = 0;
		let capacitySum = 0;
		let low = 0;
		for (const r of reservoirs) {
			const v = r.series[i];
			if (v === null) continue;
			storageSum += v;
			capacitySum += r.capacity;
			if (v / r.capacity < 0.4) low += 1;
		}
		return { storage: storageSum, capacity: capacitySum, pct: capacitySum ? storageSum / capacitySum : 0, low };
	});

	const counties = topojson.feature(topo, topo.objects.counties);
	const outline = topojson.merge(topo, topo.objects.counties.geometries);
	const countyMesh = topojson.mesh(topo, topo.objects.counties, (a, b) => a !== b);

	return { months, dates, reservoirs, byId, gauges: [ ...gauges.values() ], links: linkList, totals, counties, outline, countyMesh };
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
