// Detail card for a selected reservoir: dam type, numbers and its own storage history.
import { pctAt } from "./data.js";
import { markColor, fmtAF, fmtPct, fmtMonth } from "./scales.js";
import { DAM_TYPES, damTypeOf } from "./three/damTypes.js";
import { reservoirNotes } from "./tooltip.js";

const d3 = window.d3;

export function createDetailCard(stage, data, store, sound) {
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
		<div class="detail-sound">
			<span class="detail-sound-label">Dam sound</span>
			<span class="detail-meter" aria-hidden="true"><span></span></span>
			<span class="num detail-sound-val"></span>
			<button type="button" class="detail-listen" aria-pressed="false">Listen</button>
		</div>
		<p class="detail-note"></p>`;
	stage.appendChild(el);
	el.querySelector(".detail-close").addEventListener("click", () => store.set({ selected: null }));
	const listen = el.querySelector(".detail-listen");
	listen.addEventListener("click", async () => {
		const id = store.get().selected;
		if (!id) return;
		if (sound.audio.solo === id) sound.audio.setSolo(null);
		else {
			await sound.turnOn();
			sound.audio.setSolo(id);
		}
		renderSound(store.get());
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !el.hidden) store.set({ selected: null });
	});

	function render({ selected, dateIndex }) {
		const r = selected && data.byId.get(selected);
		el.hidden = !r;
		if (!r) return;
		const pct = pctAt(r, dateIndex);
		const storage = r.series[dateIndex];
		const kind = r.floodControl ? " · flood control" : "";
		el.querySelector(".detail-kicker").textContent = `${DAM_TYPES[damTypeOf(r)]}${kind} · ${r.county} County`;
		el.querySelector(".detail-title").textContent = r.name;
		const bar = el.querySelector(".detail-bar span");
		bar.style.width = `${Math.min(100, (pct ?? 0) * 100)}%`;
		bar.style.background = markColor(r, pct) ?? "transparent";
		el.querySelector(".detail-grid").innerHTML = `
			<div><dt>Full</dt><dd class="num js-full">${fmtPct(pct)}</dd></div>
			<div><dt>Storage</dt><dd class="num">${fmtAF(storage)}</dd></div>
			<div><dt>Capacity</dt><dd class="num">${fmtAF(r.capacity)}</dd></div>
			<div><dt>Built</dt><dd class="num">${r.yearBuilt}</dd></div>`;
		const y = d3.timeFormat("%Y");
		const range = `${y(data.dates[0])}–${y(data.dates[data.dates.length - 1])}`;
		const notes = reservoirNotes(data, r, dateIndex);
		if (r.hasData) notes.unshift(`${fmtMonth(data.dates[dateIndex])}. Line shows storage as % of capacity, ${range}.`);
		if (r.capacity !== r.capacity2016) notes.push(`Capacity from ${r.capacitySource}.`);
		if (r.note && !r.floodControl) notes.push(r.note);
		el.querySelector(".detail-note").textContent = notes.join(" ");
		drawSpark(r, dateIndex);
		renderSound({ selected, dateIndex });
	}

	// How loud this dam's voice is this month (storage, size and release), 0-100.
	function renderSound({ selected, dateIndex }) {
		const v = selected && sound.release.voicesAt(dateIndex).get(selected);
		if (!v) return;
		const pct = Math.round(v.level * 100);
		el.querySelector(".detail-meter span").style.width = `${pct}%`;
		el.querySelector(".detail-meter").classList.toggle("spill", v.spill > 0.05);
		el.querySelector(".detail-sound-val").textContent = v.spill > 0.05 ? `${pct} · spilling` : String(pct);
		const on = sound.audio.solo === selected;
		listen.setAttribute("aria-pressed", String(on));
		listen.textContent = on ? "Stop" : "Listen";
		listen.setAttribute("aria-label", on ? "Stop listening to this dam" : "Listen to this dam on its own");
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
		if (cur.p !== null) svg.append("circle").attr("cx", x(cur.d)).attr("cy", y(cur.p)).attr("r", 3.5).attr("fill", markColor(r, cur.p));
		// Year labels spaced to fit: every 2, 3 or 5 years depending on width.
		const years = d3.timeYear.range(d3.timeYear.ceil(data.dates[0]), data.dates[data.dates.length - 1]);
		const every = [ 1, 2, 3, 5, 10 ].find((k) => (years.length / k) * 34 <= w) ?? 10;
		svg.selectAll(".yr").data(years.filter((d) => d.getFullYear() % every === 0)).join("text").attr("class", "spark-year")
			.attr("x", (d) => x(d)).attr("y", h - 1).attr("text-anchor", "middle").text(d3.timeFormat("%Y"));
	}

	store.subscribe((s, changed) => {
		if (changed.includes("selected") || (changed.includes("dateIndex") && s.selected)) render(s);
	});
	return { el };
}
