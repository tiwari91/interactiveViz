// Key events (placed from the data and well-documented dates; drawn as flags on the timeline)
// and the three small charts.
import { fmtMonth, fmtMonthLong, fmtPct } from "./scales.js";

const d3 = window.d3;

// Lowest statewide month inside [from, to] (YYYY-MM), so the marker sits on the real trough.
function lowest(data, from, to) {
	let best = -1;
	data.months.forEach((m, i) => {
		if (m >= from && m <= to && (best < 0 || data.totals[i].pct < data.totals[best].pct)) best = i;
	});
	return best;
}

export function keyEvents(data) {
	const at = (m) => data.months.indexOf(m);
	const list = [
		{ id: "low-2015", short: "2012–16 low", name: "2012–16 drought low", i: lowest(data, "2014-01", "2015-12") },
		{ id: "oroville", short: "Oroville spillway", name: "Oroville spillway failure", i: at("2017-02") },
		{ id: "low-2022", short: "2020–22 low", name: "2020–22 drought low", i: lowest(data, "2021-01", "2022-12") },
		{ id: "ar-2023", short: "Atmospheric rivers", name: "2023 atmospheric rivers", i: at("2023-01") },
	];
	const out = list.filter((e) => e.i >= 0).map((e) => ({ ...e, detail: `${fmtPct(data.totals[e.i].pct)} full statewide` }));
	// Snowpack extremes, only where the data shows one: the lowest April 1 reading if it is
	// under 15% of average, and the highest month if it is over 150%.
	const sp = data.snow?.statewide ?? [];
	let lo = -1;
	let hi = -1;
	sp.forEach((v, i) => {
		if (v === null) return;
		if (data.calMonth[i] === 3 && (lo < 0 || v < sp[lo])) lo = i;
		if (hi < 0 || v > sp[hi]) hi = i;
	});
	const snowDetail = (i) => `snowpack ${Math.round(sp[i])}% of the April 1 average`;
	if (lo >= 0 && sp[lo] < 15) out.push({ id: "snow-low", short: "Snow low", name: "Snowpack low", i: lo, detail: snowDetail(lo) });
	if (hi >= 0 && sp[hi] > 150) out.push({ id: "snow-high", short: "Snow high", name: "Snowpack high", i: hi, detail: snowDetail(hi) });
	return out.sort((a, b) => a.i - b.i);
}

// One small chart: a series over the record with a marker line at the current month.
function chart(box, title) {
	box.innerHTML = `<div class="chart-head"><h3 class="panel-title js-title">${title}</h3><span class="chart-val num js-val"></span></div><svg class="chart-svg" role="img"></svg>`;
	return { svg: d3.select(box.querySelector("svg")), titleEl: box.querySelector(".js-title"), valEl: box.querySelector(".js-val") };
}

// profile(id): the 3D terrain's elevation profile of the river below that dam, or null (no
// river drawn, or the 3D terrain not built yet); the third chart then shows the reservoir's storage.
export function createCharts(el, data, store, profile = () => null) {
	el.innerHTML = "<div class=\"chart\" data-chart=\"storage\"></div><div class=\"chart\" data-chart=\"avg\"></div><div class=\"chart\" data-chart=\"reservoir\"></div><div class=\"chart\" data-chart=\"snow\"></div>";
	const largest = data.tracked.reduce((a, r) => (r.capacity > a.capacity ? r : a));
	const specs = [
		{ key: "storage", title: "Statewide storage, million AF", values: () => data.totals.map((t) => t.storage / 1e6), fmt: (v) => d3.format(".1f")(v) },
		{ key: "avg", title: "% of historical average", ref: 1, values: () => data.totals.map((t) => t.ofAvg), fmt: fmtPct },
		{ key: "reservoir", title: "", values: (r) => r.series.map((v) => (v === null ? null : v / 1e6)), fmt: (v) => d3.format(".2f")(v), cap: true },
		{ key: "snow", title: "Snowpack, % of Apr 1 average", ref: 100, values: () => data.snow.statewide, fmt: (v) => `${Math.round(v)}%` },
	];
	const parts = specs.map((s) => ({ s, ...chart(el.querySelector(`[data-chart="${s.key}"]`), s.title) }));
	const pick = () => data.byId.get(store.get().selected) || largest;

	function draw(p) {
		const node = p.svg.node();
		const w = node.clientWidth || 300;
		const h = node.clientHeight || 96;
		const r = pick();
		p.profile = p.s.key === "reservoir" && store.get().selected ? profile(r.id) : null;
		node.dataset.chartMode = p.profile ? "profile" : "series";
		if (p.profile) {
			drawProfile(p, r, w, h);
			return;
		}
		const vals = p.s.values(r);
		if (p.s.key === "reservoir") p.titleEl.textContent = `${r.name}, million AF`;
		const hi = Math.max(p.s.ref ?? 0, p.s.cap ? r.capacity / 1e6 : 0, d3.max(vals) ?? 1);
		const lo = p.s.ref ? Math.min(d3.min(vals) ?? 0, p.s.ref) : 0;
		const x = d3.scaleTime().domain(d3.extent(data.dates)).range([ 26, w - 4 ]);
		const y = d3.scaleLinear().domain([ lo * (p.s.ref ? 0.95 : 1), hi * 1.04 ]).nice(3).range([ h - 16, 4 ]);
		p.svg.selectAll("*").remove();
		p.svg.attr("aria-label", `${p.titleEl.textContent} by month, ${fmtMonth(data.dates[0])} to ${fmtMonth(data.dates[data.dates.length - 1])}`);
		const ga = p.svg.append("g").attr("class", "chart-axis");
		y.ticks(3).forEach((t) => {
			ga.append("line").attr("x1", 26).attr("x2", w - 4).attr("y1", y(t)).attr("y2", y(t));
			ga.append("text").attr("x", 22).attr("y", y(t) + 3).attr("text-anchor", "end").text(p.s.key === "avg" ? fmtPct(t) : p.s.key === "snow" ? `${t}%` : t);
		});
		const years = d3.timeYear.range(d3.timeYear.ceil(data.dates[0]), data.dates[data.dates.length - 1]);
		const every = years.length * 30 > w ? 4 : 2;
		years.filter((d) => d.getFullYear() % every === 0).forEach((d) => {
			ga.append("text").attr("x", x(d)).attr("y", h - 3).attr("text-anchor", "middle").text(d3.timeFormat("%Y")(d));
		});
		if (p.s.ref) p.svg.append("line").attr("class", "chart-ref").attr("x1", 26).attr("x2", w - 4).attr("y1", y(p.s.ref)).attr("y2", y(p.s.ref));
		if (p.s.cap) p.svg.append("line").attr("class", "chart-ref").attr("x1", 26).attr("x2", w - 4).attr("y1", y(r.capacity / 1e6)).attr("y2", y(r.capacity / 1e6));
		const def = (v) => v !== null && v !== undefined;
		const line = d3.line().defined(def).x((_, i) => x(data.dates[i])).y((v) => y(v));
		p.svg.append("path").attr("class", "chart-line").attr("d", line(vals));
		p.svg.attr("data-points", vals.filter(def).length);
		p.marker = p.svg.append("g").attr("class", "chart-marker");
		p.marker.append("line").attr("y1", 2).attr("y2", h - 16);
		p.marker.append("circle").attr("r", 3);
		p.x = x;
		p.y = y;
		p.vals = vals;
		place(p);
	}

	// Elevation along the river drawn below the selected dam: distance downstream in km against
	// the terrain's DEM height in metres, with the dam marked at the start.
	function drawProfile(p, r, w, h) {
		const pts = p.profile.points;
		const L = pts[pts.length - 1].km;
		const m0 = pts[0].m;
		const m1 = pts[pts.length - 1].m;
		const dam = /\bdam\b/i.test(r.name) ? r.name : `${r.name} dam`;
		p.titleEl.textContent = `River below ${dam}, elevation m`;
		const x = d3.scaleLinear().domain([ 0, L ]).range([ 30, w - 6 ]);
		const y = d3.scaleLinear().domain(d3.extent(pts, (q) => q.m)).nice(3).range([ h - 16, 8 ]);
		p.svg.selectAll("*").remove();
		p.svg.attr("aria-label", `Elevation of the river below ${dam} over ${Math.round(L)} km, from ${Math.round(m0)} m at the dam to ${Math.round(m1)} m`);
		const ga = p.svg.append("g").attr("class", "chart-axis");
		y.ticks(3).forEach((t) => {
			ga.append("line").attr("x1", 30).attr("x2", w - 6).attr("y1", y(t)).attr("y2", y(t));
			ga.append("text").attr("x", 26).attr("y", y(t) + 3).attr("text-anchor", "end").text(d3.format(",")(t));
		});
		x.ticks(4).forEach((t, i, all) => {
			ga.append("text").attr("x", x(t)).attr("y", h - 3).attr("text-anchor", "middle").text(i === all.length - 1 ? `${t} km` : t);
		});
		p.svg.append("path").attr("class", "chart-line").attr("d", d3.line().x((q) => x(q.km)).y((q) => y(q.m))(pts));
		const mark = p.svg.append("g").attr("class", "chart-dam").attr("transform", `translate(${x(0)},${y(m0)})`);
		mark.append("line").attr("y1", 0).attr("y2", h - 16 - y(m0));
		mark.append("circle").attr("r", 3.5);
		mark.append("text").attr("x", 6).attr("y", y(m0) < 20 ? 12 : -5).text("Dam");
		p.svg.attr("data-points", pts.length);
		p.marker = null;
		p.valEl.textContent = `${d3.format(",")(Math.round(m0))} → ${d3.format(",")(Math.round(m1))} m · ${Math.round(L)} km`;
		p.valEl.title = "Ground height (NOAA ETOPO1) along the river line drawn on the 3D map, downstream from the dam";
	}

	function place(p) {
		if (!p.marker) return;
		const i = store.get().dateIndex;
		const v = p.vals[i];
		p.marker.attr("transform", `translate(${p.x(data.dates[i])},0)`);
		p.marker.select("circle").attr("cy", v === null || v === undefined ? -99 : p.y(v));
		p.valEl.textContent = v === null || v === undefined ? "—" : `${p.s.fmt(v)} · ${fmtMonth(data.dates[i])}`;
		p.valEl.title = fmtMonthLong(data.dates[i]);
	}

	store.subscribe((s, changed) => {
		if (changed.includes("selected")) draw(parts[2]);
		if (changed.includes("dateIndex")) parts.forEach(place);
	});
	const ro = new ResizeObserver(() => parts.forEach(draw));
	parts.forEach((p) => ro.observe(p.svg.node()));
	// Called once the 3D terrain is built, when river profiles become available.
	return { redraw: () => draw(parts[2]) };
}
