// Detail card for a selected reservoir: dam type, numbers and its own storage history.
import { pctAt } from "./data.js";
import { colorFor, fmtAF, fmtPct, fmtMonth } from "./scales.js";
import { DAM_TYPES, damTypeOf } from "./three/damTypes.js";

const d3 = window.d3;

export function createDetailCard(stage, data, store) {
	const el = document.createElement("section");
	el.className = "detail-card";
	el.hidden = true;
	el.setAttribute("aria-live", "polite");
	el.setAttribute("aria-label", "Reservoir details");
	el.innerHTML = `
		<button type="button" class="detail-close" aria-label="Close details">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
		</button>
		<p class="detail-kicker"></p>
		<h3 class="detail-title"></h3>
		<div class="detail-bar"><span></span></div>
		<dl class="detail-grid"></dl>
		<svg class="detail-spark" aria-hidden="true"></svg>
		<p class="detail-note"></p>`;
	stage.appendChild(el);
	el.querySelector(".detail-close").addEventListener("click", () => store.set({ selected: null }));
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !el.hidden) store.set({ selected: null });
	});

	function render({ selected, dateIndex }) {
		const r = selected && data.byId.get(selected);
		el.hidden = !r;
		if (!r) return;
		const pct = pctAt(r, dateIndex);
		const storage = r.series[dateIndex];
		el.querySelector(".detail-kicker").textContent = `${DAM_TYPES[damTypeOf(r)]} · ${r.county} County`;
		el.querySelector(".detail-title").textContent = r.name;
		const bar = el.querySelector(".detail-bar span");
		bar.style.width = `${Math.min(100, (pct ?? 0) * 100)}%`;
		bar.style.background = colorFor(pct);
		el.querySelector(".detail-grid").innerHTML = `
			<div><dt>Full</dt><dd class="num">${fmtPct(pct)}</dd></div>
			<div><dt>Storage</dt><dd class="num">${fmtAF(storage)}</dd></div>
			<div><dt>Capacity</dt><dd class="num">${fmtAF(r.capacity)}</dd></div>
			<div><dt>Built</dt><dd class="num">${r.yearBuilt}</dd></div>`;
		el.querySelector(".detail-note").textContent = !r.hasData ? "No storage readings on CDEC for this station."
			: storage === null ? `No reading for ${fmtMonth(data.dates[dateIndex])}.`
				: `${fmtMonth(data.dates[dateIndex])}. Line shows storage as % of capacity, 2011–2017.`;
		drawSpark(r, dateIndex);
	}

	function drawSpark(r, i) {
		const svg = d3.select(el.querySelector(".detail-spark"));
		const w = el.clientWidth - 32 || 240;
		const h = 64;
		svg.attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
		svg.selectAll("*").remove();
		const x = d3.scaleTime().domain(d3.extent(data.dates)).range([ 0, w ]);
		const y = d3.scaleLinear().domain([ 0, 1.05 ]).range([ h - 12, 2 ]);
		const pts = r.series.map((v, k) => ({ d: data.dates[k], p: v === null ? null : Math.min(1.05, v / r.capacity) }));
		const line = d3.line().defined((d) => d.p !== null).x((d) => x(d.d)).y((d) => y(d.p)).curve(d3.curveMonotoneX);
		const area = d3.area().defined((d) => d.p !== null).x((d) => x(d.d)).y0(h - 12).y1((d) => y(d.p)).curve(d3.curveMonotoneX);
		svg.append("line").attr("class", "spark-full").attr("x1", 0).attr("x2", w).attr("y1", y(1)).attr("y2", y(1));
		svg.append("path").attr("class", "spark-area").attr("d", area(pts));
		svg.append("path").attr("class", "spark-line").attr("d", line(pts));
		const cur = pts[i];
		svg.append("line").attr("class", "spark-now").attr("x1", x(cur.d)).attr("x2", x(cur.d)).attr("y1", 0).attr("y2", h - 12);
		if (cur.p !== null) svg.append("circle").attr("cx", x(cur.d)).attr("cy", y(cur.p)).attr("r", 3.5).attr("fill", colorFor(cur.p));
		svg.selectAll(".yr").data([ 2012, 2014, 2016 ]).join("text").attr("class", "spark-year")
			.attr("x", (d) => x(new Date(d, 0, 1))).attr("y", h - 1).attr("text-anchor", "middle").text((d) => d);
	}

	store.subscribe((s, changed) => {
		if (changed.includes("selected") || (changed.includes("dateIndex") && s.selected)) render(s);
	});
	return { el };
}
