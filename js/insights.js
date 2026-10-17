// Key events (placed from the data and well-documented dates) and the three small charts.
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
		{ id: "low-2015", icon: "▼", name: "2012–16 drought low", i: lowest(data, "2014-01", "2015-12") },
		{ id: "oroville", icon: "!", name: "Oroville spillway failure", i: at("2017-02") },
		{ id: "low-2022", icon: "▼", name: "2020–22 drought low", i: lowest(data, "2021-01", "2022-12") },
		{ id: "ar-2023", icon: "≋", name: "2023 atmospheric rivers", i: at("2023-01") },
	];
	return list.filter((e) => e.i >= 0).map((e) => ({ ...e, detail: `${fmtPct(data.totals[e.i].pct)} full statewide` }));
}

export function createKeyEvents(el, data, store, events) {
	el.innerHTML = `<h3 class="panel-title">Key events</h3>
		<ul class="event-list">${events.map((e) => `
			<li><button type="button" class="event-btn" data-event="${e.id}" data-index="${e.i}">
				<span class="event-icon" aria-hidden="true">${e.icon}</span>
				<span class="event-name">${e.name}</span>
				<span class="event-time num">${fmtMonth(data.dates[e.i])}</span>
			</button></li>`).join("")}</ul>`;
	const btns = [ ...el.querySelectorAll(".event-btn") ];
	btns.forEach((b) => b.addEventListener("click", () => store.set({ dateIndex: +b.dataset.index, playing: false })));
	const render = ({ dateIndex }) => btns.forEach((b) => b.setAttribute("aria-current", String(+b.dataset.index === dateIndex)));
	store.subscribe((s, changed) => changed.includes("dateIndex") && render(s));
	render(store.get());
}

// One small chart: a series over the record with a marker line at the current month.
function chart(box, title) {
	box.innerHTML = `<div class="chart-head"><h3 class="panel-title js-title">${title}</h3><span class="chart-val num js-val"></span></div><svg class="chart-svg" role="img"></svg>`;
	return { svg: d3.select(box.querySelector("svg")), titleEl: box.querySelector(".js-title"), valEl: box.querySelector(".js-val") };
}

export function createCharts(el, data, store) {
	el.innerHTML = "<div class=\"chart\" data-chart=\"storage\"></div><div class=\"chart\" data-chart=\"avg\"></div><div class=\"chart\" data-chart=\"reservoir\"></div>";
	const largest = data.tracked.reduce((a, r) => (r.capacity > a.capacity ? r : a));
	const specs = [
		{ key: "storage", title: "Statewide storage, million AF", area: true, values: () => data.totals.map((t) => t.storage / 1e6), fmt: (v) => d3.format(".1f")(v) },
		{ key: "avg", title: "% of historical average", ref: 1, values: () => data.totals.map((t) => t.ofAvg), fmt: fmtPct },
		{ key: "reservoir", title: "", values: (r) => r.series.map((v) => (v === null ? null : v / 1e6)), fmt: (v) => d3.format(".2f")(v), cap: true },
	];
	const parts = specs.map((s) => ({ s, ...chart(el.querySelector(`[data-chart="${s.key}"]`), s.title) }));
	const pick = () => data.byId.get(store.get().selected) || largest;

	function draw(p) {
		const node = p.svg.node();
		const w = node.clientWidth || 300;
		const h = node.clientHeight || 96;
		const r = pick();
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
			ga.append("text").attr("x", 22).attr("y", y(t) + 3).attr("text-anchor", "end").text(p.s.key === "avg" ? fmtPct(t) : t);
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
		if (p.s.area) p.svg.append("path").attr("class", "chart-area").attr("d", d3.area().defined(def).x((_, i) => x(data.dates[i])).y0(y(y.domain()[0])).y1((v) => y(v))(vals));
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
}
