// Side panel: totals over the tracked reservoirs and the largest reservoirs for the current month.
import { pctAt, ofAvgAt } from "./data.js";
import { markColor, fmtMAF, fmtMonth, fmtPct } from "./scales.js";

const TOP_N = 8;

export function createSummary(el, data, store, onPick) {
	const largest = [ ...data.reservoirs ].sort((a, b) => b.capacity - a.capacity).slice(0, TOP_N);
	const excluded = [ ...data.floodControl.map((r) => r.name.replace(/ Dam$/, "")) ];

	el.innerHTML = `
		<div>
			<h3 class="js-state-title"></h3>
			<div class="big num js-state-pct"></div>
			<div class="sub js-state-sub"></div>
			<div class="sub js-state-avg"></div>
			<div class="sub js-state-delta"></div>
		</div>
		<div>
			<h3>Below 40% full</h3>
			<div class="big num js-low"></div>
			<div class="sub js-low-sub"></div>
		</div>
		<p class="summary-note span-all js-note"></p>
		<div class="span-all">
			<h3>Largest reservoirs</h3>
			<ul class="summary-list">
				${largest.map((r) => `
					<li><button type="button" data-id="${r.id}">
						<span class="swatch"></span><span class="name">${r.name}</span><span class="num pct"></span>
					</button></li>`).join("")}
			</ul>
		</div>`;

	const rows = largest.map((r) => ({ r, btn: el.querySelector(`[data-id="${r.id}"]`) }));
	rows.forEach(({ r, btn }) => btn.addEventListener("click", () => onPick(r)));

	function render({ dateIndex, selected }) {
		const t = data.totals[dateIndex];
		const prov = data.provisional[dateIndex] ? " · provisional" : "";
		el.querySelector(".js-state-title").textContent = `${data.tracked.length} tracked reservoirs, ${fmtMonth(data.dates[dateIndex])}${prov}`;
		el.querySelector(".js-state-pct").textContent = fmtPct(t.pct);
		el.querySelector(".js-state-sub").textContent = `${fmtMAF(t.storage)} of ${fmtMAF(t.capacity)} capacity (AF = acre-feet)`;
		const mName = d3.timeFormat("%B")(data.dates[dateIndex]);
		el.querySelector(".js-state-avg").innerHTML = t.ofAvg === null ? "" : `<strong class="${t.ofAvg < 0.8 ? "below-avg" : t.ofAvg > 1.1 ? "above-avg" : ""}">${fmtPct(t.ofAvg)} of average</strong> for ${mName} (${data.avgYears.from}–${data.avgYears.to})`;
		const dEl = el.querySelector(".js-state-delta");
		if (dateIndex > 0) {
			const diff = (t.pct - data.totals[dateIndex - 1].pct) * 100;
			dEl.textContent = `${Math.abs(diff) < 0.05 ? "No change" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff).toFixed(1)} points`} since ${fmtMonth(data.dates[dateIndex - 1])}`;
			dEl.className = `sub js-state-delta ${diff > 0.05 ? "up" : diff < -0.05 ? "down" : ""}`;
		} else dEl.textContent = "";
		el.querySelector(".js-low").textContent = t.low;
		el.querySelector(".js-low-sub").textContent = `of ${t.reporting} reporting this month`;
		const notes = [ `Excludes flood-control basins (${excluded.join(", ")}), which are kept empty by design.` ];
		if (t.filled.length) {
			const how = t.filled.map((r) => `${r.name} ${r.filled[dateIndex] === "carried" ? "carried forward" : "interpolated"}`);
			notes.push(`Gap filled: ${how.join("; ")}.`);
		}
		if (t.reporting < data.tracked.length) notes.push(`${data.tracked.length - t.reporting} reservoir(s) not reporting.`);
		el.querySelector(".js-note").textContent = notes.join(" ");
		for (const { r, btn } of rows) {
			const pct = pctAt(r, dateIndex);
			const color = markColor(r, pct);
			const sw = btn.querySelector(".swatch");
			sw.style.background = color ?? "";
			sw.classList.toggle("no-data", color === null);
			sw.classList.toggle("flood", r.floodControl);
			btn.querySelector(".pct").textContent = fmtPct(pct);
			btn.setAttribute("aria-current", selected === r.id ? "true" : "false");
			const oa = ofAvgAt(data, r, dateIndex);
			btn.title = oa === null ? "" : `${fmtPct(oa)} of the average for this month`;
			btn.setAttribute("aria-label", `${r.name}, ${pct === null ? "no data" : `${fmtPct(pct)} full`}${oa === null ? "" : `, ${fmtPct(oa)} of average`}. Show on map`);
		}
	}

	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex") || changed.includes("selected")) render(s);
	});
	render(store.get());
}
