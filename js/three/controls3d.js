// Overlay controls for the 3D view: drought replay, compare, sky and quality.
import { PRESETS } from "./sky.js";
import { fmtMonth, fmtPct } from "../scales.js";

// The largest reservoirs, quoted in each compare half so the same lakes can be read side by side.
const KEY = [ "SHA", "ORO", "FOL", "NML" ];
const short = (name) => name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir|Lake)$/, "");

export function createControls3D(stage, data, handlers) {
	const bar = document.createElement("div");
	bar.className = "controls-3d";
	bar.hidden = true;
	bar.innerHTML = `
		<button type="button" class="chip js-replay" aria-pressed="false" title="Drought replay">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg><span>Drought replay</span>
		</button>
		<button type="button" class="chip js-compare" aria-pressed="false" title="Compare two months">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4 7h5v10H4zM15 7h5v10h-5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>Compare</span>
		</button>
		<button type="button" class="chip js-links" aria-pressed="false" title="Show every reservoir's river-gauge links (data, not rivers)">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18c4-9 12-9 16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.5"/><circle cx="4" cy="18" r="2"/></svg><span>Gauge links</span>
		</button>
		<label class="chip select-chip"><span class="sr-only">Time of day</span>
			<select class="js-sky" aria-label="Time of day">
				${Object.entries(PRESETS).map(([ k, p ]) => `<option value="${k}">${p.label}</option>`).join("")}
			</select>
		</label>
		<label class="chip select-chip"><span class="sr-only">Quality</span>
			<select class="js-quality" aria-label="Render quality">
				<option value="low">Low quality</option>
				<option value="high">High quality</option>
			</select>
		</label>`;
	stage.appendChild(bar);

	const split = document.createElement("div");
	split.className = "compare-split";
	split.hidden = true;
	split.innerHTML = `
		<div class="compare-tag compare-left">
			<select class="js-compare-month" aria-label="Month on the left">
				${data.months.map((m, i) => `<option value="${i}">${fmtMonth(data.dates[i])}</option>`).join("")}
			</select>
			<p class="compare-stat js-stat-left" aria-live="polite"></p>
		</div>
		<div class="compare-tag compare-right"><span class="js-compare-now"></span><p class="compare-stat js-stat-right" aria-live="polite"></p></div>
		<div class="compare-handle" role="slider" tabindex="0" aria-label="Compare divider" aria-valuemin="5" aria-valuemax="95" aria-valuenow="50"><span></span></div>`;
	stage.appendChild(split);

	const $ = (s, root = bar) => root.querySelector(s);
	$(".js-replay").addEventListener("click", () => handlers.replay());
	$(".js-compare").addEventListener("click", () => handlers.compare());
	$(".js-links").addEventListener("click", () => handlers.links());
	$(".js-sky").addEventListener("change", (e) => handlers.sky(e.target.value));
	$(".js-quality").addEventListener("change", (e) => handlers.quality(e.target.value));
	split.querySelector(".js-compare-month").addEventListener("change", (e) => handlers.compareMonth(+e.target.value));

	const handle = split.querySelector(".compare-handle");
	let frac = 0.5;
	let stacked = false;
	const setFrac = (f) => {
		frac = Math.min(0.95, Math.max(0.05, f));
		split.style.setProperty("--split", `${frac * 100}%`);
		handle.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
		handlers.divider(frac);
	};
	handle.addEventListener("pointerdown", (e) => {
		handle.setPointerCapture(e.pointerId);
		e.stopPropagation();
		const move = (ev) => {
			const r = stage.getBoundingClientRect();
			setFrac(stacked ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width);
		};
		const up = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
	});
	handle.addEventListener("keydown", (e) => {
		if (e.key === "ArrowLeft" || e.key === "ArrowUp") setFrac(frac - 0.05);
		if (e.key === "ArrowRight" || e.key === "ArrowDown") setFrac(frac + 0.05);
		if (e.key.startsWith("Arrow")) e.preventDefault();
	});
	setFrac(0.5);

	return {
		show(on) {
			bar.hidden = !on;
			if (!on) split.hidden = true;
		},
		setState({ replaying, comparing, links, sky, quality, compareIndex, dateIndex }) {
			$(".js-links").setAttribute("aria-pressed", String(Boolean(links)));
			$(".js-replay").setAttribute("aria-pressed", String(replaying));
			$(".js-replay span").textContent = replaying ? "Stop replay" : "Drought replay";
			$(".js-compare").setAttribute("aria-pressed", String(comparing));
			$(".js-sky").value = sky;
			$(".js-quality").value = quality;
			split.hidden = !comparing;
			split.querySelector(".js-compare-month").value = String(compareIndex);
			split.querySelector(".js-compare-now").textContent = fmtMonth(data.dates[dateIndex]);
			const stat = (i) => {
				const keys = KEY.map((id) => data.reservoirs.find((r) => r.id === id)).filter(Boolean)
					.map((r) => `${short(r.name)} ${fmtPct(r.series[i] === null ? null : r.series[i] / r.capacity)}`);
				return `<strong>${fmtPct(data.totals[i].pct)}</strong> full statewide<span class="compare-keys">${keys.map((k) => `<span>${k}</span>`).join(" · ")}</span>`;
			};
			split.querySelector(".js-stat-left").innerHTML = stat(compareIndex);
			split.querySelector(".js-stat-right").innerHTML = stat(dateIndex);
		},
		get divider() {
			return frac;
		},
		// Portrait stages split top (picked month) / bottom (current month).
		get stacked() {
			return stacked;
		},
		setStacked(on) {
			stacked = on;
			split.classList.toggle("stacked", on);
			handle.setAttribute("aria-orientation", on ? "vertical" : "horizontal");
			split.querySelector(".js-compare-month").setAttribute("aria-label", on ? "Month on top" : "Month on the left");
		},
		tagRects: () => (split.hidden ? [] : [ ...split.querySelectorAll(".compare-tag") ].map((t) => t.getBoundingClientRect())),
	};
}
