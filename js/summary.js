// Side panel: statewide numbers and the largest reservoirs for the current month.
import { pctAt } from "./data.js";
import { colorFor, fmtMAF, fmtMonth, fmtPct } from "./scales.js";

const TOP_N = 8;

export function createSummary(el, data, store, onPick) {
	const reporting = data.reservoirs.filter((r) => r.hasData).length;
	const largest = [ ...data.reservoirs ].sort((a, b) => b.capacity - a.capacity).slice(0, TOP_N);

	el.innerHTML = `
		<div>
			<h3 class="js-state-title">Statewide</h3>
			<div class="big num js-state-pct"></div>
			<div class="sub js-state-sub"></div>
		</div>
		<div>
			<h3>Below 40% full</h3>
			<div class="big num js-low"></div>
			<div class="sub">of ${reporting} reporting reservoirs</div>
		</div>
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
		el.querySelector(".js-state-title").textContent = `Statewide, ${fmtMonth(data.dates[dateIndex])}`;
		el.querySelector(".js-state-pct").textContent = fmtPct(t.pct);
		el.querySelector(".js-state-sub").textContent = `${fmtMAF(t.storage)} of ${fmtMAF(t.capacity)} capacity`;
		el.querySelector(".js-low").textContent = t.low;
		for (const { r, btn } of rows) {
			const pct = pctAt(r, dateIndex);
			btn.querySelector(".swatch").style.background = colorFor(pct);
			btn.querySelector(".pct").textContent = fmtPct(pct);
			btn.setAttribute("aria-current", selected === r.id ? "true" : "false");
			btn.setAttribute("aria-label", `${r.name}, ${fmtPct(pct)} full. Show on map`);
		}
	}

	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex") || changed.includes("selected")) render(s);
	});
	render(store.get());
}
