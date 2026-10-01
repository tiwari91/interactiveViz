// Timeline: play/pause, a scrubber over a statewide storage sparkline, date readout.
import { fmtMonth, fmtMonthLong, fmtPct } from "./scales.js";

const d3 = window.d3;
const PLAY = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 4.5v15l13-7.5z\"/></svg>";
const PAUSE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 4h4.5v16H6zM13.5 4H18v16h-4.5z\"/></svg>";
const STEP_MS = 420;

// Drought emergency: proclaimed January 2014, lifted April 2017.
const DROUGHT = [ new Date(2014, 0, 1), new Date(2017, 3, 1) ];

export function createTimeline(el, { dates, totals }, store) {
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

	function drawSpark() {
		const w = el.querySelector(".track").clientWidth;
		const h = 36;
		// Thumb centre travels from 2px to w-2px; match it.
		const x = d3.scaleTime().domain(d3.extent(dates)).range([ 2, w - 2 ]);
		const y = d3.scaleLinear().domain([ 0, 1 ]).range([ h, 4 ]);
		svg.selectAll("*").remove();
		svg.append("rect").attr("class", "drought-band")
			.attr("x", x(DROUGHT[0])).attr("width", x(DROUGHT[1]) - x(DROUGHT[0]))
			.attr("y", 0).attr("height", h);
		if (w >= 420) {
			svg.append("text").attr("class", "band-label").attr("x", x(DROUGHT[0]) + 6).attr("y", 11).text("Drought emergency");
		}
		const area = d3.area().x((_, i) => x(dates[i])).y0(h).y1((d) => y(d.pct)).curve(d3.curveMonotoneX);
		svg.append("path").attr("class", "spark-area").attr("d", area(totals));
		svg.append("path").attr("class", "spark-line").attr("d", area.lineY1()(totals));
		const years = d3.timeYear.range(d3.timeYear.ceil(dates[0]), dates[dates.length - 1]);
		const step = w < 420 ? 2 : 1;
		const ticks = svg.selectAll(".year-tick").data(years.filter((_, i) => i % step === 0)).join("g")
			.attr("class", "year-tick").attr("transform", (d) => `translate(${x(d)},0)`);
		ticks.append("line").attr("y1", h).attr("y2", h + 4);
		ticks.append("text").attr("y", h + 15).attr("text-anchor", "middle").text(d3.timeFormat("%Y"));
	}

	function render({ dateIndex, playing }) {
		input.value = dateIndex;
		const t = totals[dateIndex];
		const label = fmtMonthLong(dates[dateIndex]);
		input.setAttribute("aria-valuetext", `${label}, statewide storage ${fmtPct(t.pct)} of capacity`);
		monthEl.textContent = fmtMonth(dates[dateIndex]);
		metaEl.textContent = `${fmtPct(t.pct)} full statewide`;
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
		}, STEP_MS);
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
