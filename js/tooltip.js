// One tooltip element positioned inside the stage, used by both views.
// It remembers what it is showing so a date change re-renders it in place.
import { pctAt, flowAt, valueNote } from "./data.js";
import { markColor, fmtAF, fmtPct, fmtCfs, fmtMonth } from "./scales.js";

// Notes shared by the tooltip and the detail card so both always say the same thing.
export function reservoirNotes(data, r, i) {
	const storage = r.series[i];
	const pct = pctAt(r, i);
	const notes = [];
	if (r.floodControl) notes.push("Flood-control basin, kept nearly empty by design to catch storm runoff. Not counted in the % full totals.");
	if (!r.hasData) notes.push("No storage readings on CDEC for this station.");
	else if (storage === null) notes.push("No reading this month.");
	else {
		const v = valueNote(r, i);
		if (v) notes.push(v);
		if (pct > 1) {
			notes.push(r.purpose === "natural-lake" ? "Above the full-lake level: the lake is in flood."
				: "Above the spillway-crest capacity (surcharge storage during high water).");
		}
		if (data.provisional[i]) notes.push("Provisional CDEC data, not yet revised.");
	}
	return notes;
}

export function createTooltip(el, stage, data) {
	let current = null; // { kind, item, x, y }

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

	function renderReservoir(r, i) {
		const storage = r.series[i];
		const pct = pctAt(r, i);
		const color = markColor(r, pct);
		const bar = pct === null ? "" : `<div class="tt-bar"><span style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${color}"></span></div>`;
		const notes = reservoirNotes(data, r, i).map((n) => `<div class="tt-note">${n}</div>`).join("");
		el.innerHTML = `
			<div class="tt-title">${r.name}</div>
			${bar}
			<dl>
				<dt>Storage</dt><dd>${fmtAF(storage)}</dd>
				<dt>Capacity</dt><dd>${fmtAF(r.capacity)}</dd>
				<dt>Full</dt><dd class="tt-pct">${fmtPct(pct)}</dd>
				<dt>Month</dt><dd class="tt-month">${fmtMonth(data.dates[i])}</dd>
				<dt>County</dt><dd>${r.county}</dd>
				<dt>Built</dt><dd>${r.yearBuilt}</dd>
			</dl>${notes}`;
	}

	function renderGauge(g, i) {
		const f = flowAt(g, i);
		const note = !g.flow ? "No daily flow on CDEC; link drawn at a fixed width."
			: f === null ? "No flow reading this month; link drawn at a fixed width." : "";
		el.innerHTML = `
			<div class="tt-title">${g.basin} basin gauge (${g.id})</div>
			<dl>
				<dt>Mean flow</dt><dd>${fmtCfs(f)}</dd>
				<dt>Month</dt><dd class="tt-month">${fmtMonth(data.dates[i])}</dd>
				<dt>County</dt><dd>${g.county}</dd>
			</dl>${note ? `<div class="tt-note">${note}</div>` : ""}`;
	}

	function show(kind, item, i, x, y) {
		current = { kind, item, x, y };
		if (kind === "reservoir") renderReservoir(item, i);
		else renderGauge(item, i);
		el.hidden = false;
		place(x, y);
	}

	return {
		showReservoir(r, i, _date, x, y) {
			show("reservoir", r, i, x, y);
		},
		showGauge(g, i, _date, x, y) {
			show("gauge", g, i, x, y);
		},
		// Re-render whatever is open for a new month, in place.
		refresh(i) {
			if (!current || el.hidden) return;
			show(current.kind, current.item, i, current.x, current.y);
		},
		hide() {
			current = null;
			el.hidden = true;
		},
	};
}
