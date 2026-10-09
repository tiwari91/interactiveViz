// Timeline: play/pause, a scrubber over a statewide storage sparkline, date readout.
import { fmtMonth, fmtMonthLong, fmtPct } from "./scales.js";

const d3 = window.d3;
const PLAY = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 4.5v15l13-7.5z\"/></svg>";
const PAUSE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 4h4.5v16H6zM13.5 4H18v16h-4.5z\"/></svg>";
// Playback lasts about 45 s however long the record is, within these bounds per month.
const STEP_MS = (n) => Math.max(160, Math.min(420, 45000 / n));

export function createTimeline(el, { dates, totals, droughtPeriods, provisional }, store) {
	const stepMs = STEP_MS(dates.length);
	const provFrom = provisional.indexOf(true);
	el.innerHTML = `
		<button type="button" class="play-btn" aria-label="Play timeline">${PLAY}</button>
		<div class="track">
			<svg aria-hidden="true"></svg>
			<input type="range" min="0" max="${dates.length - 1}" step="1" aria-label="Month">
		</div>
		<div class="date-readout" aria-hidden="true"><span class="month"></span><span class="meta"></span></div>`;
	const btn = el.querySelector(".play-btn");
	const input = el.querySelector("input");
	const svg = d3.select(el.querySelector(".track svg"));
	const monthEl = el.querySelector(".month");
	const metaEl = el.querySelector(".meta");
	let timer = null;
	let head = null;
	let xOf = null;

	function drawSpark() {
		const w = el.querySelector(".track").clientWidth;
		const h = 36;
		// Thumb centre travels from 2px to w-2px; match it.
		const x = d3.scaleTime().domain(d3.extent(dates)).range([ 2, w - 2 ]);
		const y = d3.scaleLinear().domain([ 0, 1 ]).range([ h, 4 ]);
		xOf = x;
		svg.selectAll("*").remove();
		// Drought emergencies (from data/drought_periods.csv), labelled when there is room.
		for (const p of droughtPeriods) {
			const x0 = x(p.start);
			const bw = Math.max(0, x(p.end) - x0);
			svg.append("rect").attr("class", "drought-band").attr("x", x0).attr("width", bw).attr("y", 0).attr("height", h);
			svg.append("rect").attr("class", "drought-cap").attr("x", x0).attr("width", bw).attr("y", 0).attr("height", 2.5);
			const label = bw >= 118 ? "Drought emergency" : bw >= 50 ? "Drought" : "";
			if (label) svg.append("text").attr("class", "band-label").attr("x", x0 + 5).attr("y", 13).text(label);
		}
		// Provisional months (not yet revised by the operators): a light hatch.
		if (provFrom >= 0) {
			svg.append("rect").attr("class", "provisional-band")
				.attr("x", x(dates[provFrom])).attr("width", Math.max(2, x(dates[dates.length - 1]) - x(dates[provFrom]) + 2))
				.attr("y", 0).attr("height", h);
		}
		const area = d3.area().x((_, i) => x(dates[i])).y0(h).y1((d) => y(d.pct)).curve(d3.curveMonotoneX);
		svg.append("path").attr("class", "spark-area").attr("d", area(totals));
		svg.append("path").attr("class", "spark-line").attr("d", area.lineY1()(totals));
		// Statewide extremes of the record: click to jump there and compare.
		const ext = [ [ "Low", d3.least(totals.keys(), (i) => totals[i].pct) ], [ "High", d3.greatest(totals.keys(), (i) => totals[i].pct) ] ];
		const mark = svg.selectAll(".extreme").data(ext).join("g").attr("class", "extreme")
			.attr("transform", ([ , i ]) => `translate(${x(dates[i])},${y(totals[i].pct)})`)
			.on("click", (_, [ , i ]) => store.set({ dateIndex: i, playing: false }));
		mark.append("title").text(([ k, i ]) => `${k === "Low" ? "Lowest" : "Highest"} month on record: ${fmtMonthLong(dates[i])}, ${fmtPct(totals[i].pct)} full. Click to jump.`);
		mark.append("circle").attr("r", 3);
		mark.append("text").attr("class", "extreme-label").attr("y", -7).attr("text-anchor", "middle")
			.text(([ k, i ]) => `${k} ${fmtPct(totals[i].pct)}`);
		// The selected month: a line and a dot riding the storage curve.
		head = svg.append("g").attr("class", "playhead");
		head.append("line").attr("y1", 0).attr("y2", h);
		head.append("circle").attr("r", 4.5);
		const years = d3.timeYear.range(d3.timeYear.ceil(dates[0]), dates[dates.length - 1]);
		placeHead(store.get().dateIndex);
		// A tick for every year; labels thin out to every 2 or 5 years on narrow screens.
		const every = [ 1, 2, 5, 10 ].find((k) => (years.length / k) * 38 <= w) ?? 10;
		const ticks = svg.selectAll(".year-tick").data(years).join("g")
			.classed("minor", (d) => d.getFullYear() % every !== 0)
			.attr("class", "year-tick").attr("transform", (d) => `translate(${x(d)},0)`);
		ticks.append("line").attr("y1", h).attr("y2", h + 4);
		ticks.filter((d) => d.getFullYear() % every === 0)
			.append("text").attr("y", h + 15).attr("text-anchor", "middle").text(d3.timeFormat("%Y"));
	}

	function placeHead(i) {
		if (!head || !xOf) return;
		head.attr("transform", `translate(${xOf(dates[i])},0)`);
		head.select("circle").attr("cy", 36 - totals[i].pct * 32);
	}

	function render({ dateIndex, playing }) {
		placeHead(dateIndex);
		input.value = dateIndex;
		const t = totals[dateIndex];
		const label = fmtMonthLong(dates[dateIndex]);
		const prov = provisional[dateIndex];
		input.setAttribute("aria-valuetext", `${label}, ${fmtPct(t.pct)} of tracked capacity${prov ? ", provisional data" : ""}`);
		monthEl.textContent = fmtMonth(dates[dateIndex]);
		const dr = droughtPeriods.find((p) => dates[dateIndex] >= p.start && dates[dateIndex] <= p.end);
		metaEl.textContent = `${fmtPct(t.pct)} full, tracked${prov ? " · provisional" : ""}${dr ? " · state drought emergency" : ""}`;
		el.classList.toggle("is-provisional", prov);
		btn.innerHTML = playing ? PAUSE : PLAY;
		btn.setAttribute("aria-label", playing ? "Pause timeline" : "Play timeline");
	}

	function stop() {
		clearInterval(timer);
		timer = null;
	}

	function start() {
		stop();
		if (store.get().dateIndex >= dates.length - 1) store.set({ dateIndex: 0 });
		timer = setInterval(() => {
			const next = store.get().dateIndex + 1;
			if (next >= dates.length) store.set({ playing: false });
			else store.set({ dateIndex: next });
		}, stepMs);
	}

	btn.addEventListener("click", () => store.set({ playing: !store.get().playing }));
	input.addEventListener("input", () => store.set({ dateIndex: +input.value, playing: false }));

	store.subscribe((s, changed) => {
		if (changed.includes("playing")) (s.playing ? start() : stop());
		if (changed.includes("dateIndex") || changed.includes("playing")) render(s);
	});

	new ResizeObserver(drawSpark).observe(el.querySelector(".track"));
	render(store.get());
}
