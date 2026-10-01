// One tooltip element positioned inside the stage, used by both views.
import { pctAt, flowAt } from "./data.js";
import { colorFor, fmtAF, fmtPct, fmtCfs, fmtMonth } from "./scales.js";

export function createTooltip(el, stage) {
	function place(x, y) {
		const pad = 12;
		const sw = stage.clientWidth;
		const sh = stage.clientHeight;
		const tw = el.offsetWidth;
		const th = el.offsetHeight;
		let left = x + 14;
		let top = y - th - 12;
		if (left + tw + pad > sw) left = x - tw - 14;
		if (left < pad) left = Math.max(pad, Math.min(sw - tw - pad, x - tw / 2));
		if (top < pad) top = y + 18;
		if (top + th + pad > sh) top = sh - th - pad;
		el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
	}

	return {
		showReservoir(r, i, date, x, y) {
			const storage = r.series[i];
			const pct = pctAt(r, i);
			const bar = pct === null ? "" : `<div class="tt-bar"><span style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${colorFor(pct)}"></span></div>`;
			const note = !r.hasData
				? "<div class=\"tt-note\">No storage readings on CDEC for this station.</div>"
				: storage === null ? "<div class=\"tt-note\">No reading this month.</div>"
					: pct > 1 ? "<div class=\"tt-note\">Reported storage exceeds the listed capacity.</div>" : "";
			el.innerHTML = `
				<div class="tt-title">${r.name}</div>
				${bar}
				<dl>
					<dt>Storage</dt><dd>${fmtAF(storage)}</dd>
					<dt>Capacity</dt><dd>${fmtAF(r.capacity)}</dd>
					<dt>Full</dt><dd>${fmtPct(pct)}</dd>
					<dt>Month</dt><dd>${fmtMonth(date)}</dd>
					<dt>County</dt><dd>${r.county}</dd>
					<dt>Built</dt><dd>${r.yearBuilt}</dd>
				</dl>${note}`;
			el.hidden = false;
			place(x, y);
		},
		showGauge(g, i, date, x, y) {
			el.innerHTML = `
				<div class="tt-title">${g.basin} basin gauge (${g.id})</div>
				<dl>
					<dt>Mean flow</dt><dd>${fmtCfs(flowAt(g, i))}</dd>
					<dt>Month</dt><dd>${fmtMonth(date)}</dd>
					<dt>County</dt><dd>${g.county}</dd>
				</dl>${g.flow ? "" : "<div class=\"tt-note\">No daily flow on CDEC; link drawn at a fixed width.</div>"}`;
			el.hidden = false;
			place(x, y);
		},
		hide() {
			el.hidden = true;
		},
	};
}
