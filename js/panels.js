// Sidebar panels: the 3D Layers list and the selected reservoir's key/value card.
import { pctAt, ofAvgAt } from "./data.js";
import { markColor, fmtAF, fmtPct, fmtMonth } from "./scales.js";
import { DAM_TYPES, damTypeOf } from "./three/damTypes.js";

// Each layer switches real scene objects in view3d.js (setLayer). Only the labels layer has
// an opacity slider: it is the one layer whose opacity can change without new shaders.
// Small line icons in the survey-drawing style, drawn with currentColor.
const ICON = {
	terrain: "<path d=\"M2 19l6-9 4 5 3-4 7 8z\"/><path d=\"M6.5 12.5l1.5-2.5 1.6 2\"/>",
	reservoirs: "<path d=\"M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2\"/><path d=\"M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2\"/><path d=\"M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2\"/>",
	rivers: "<path d=\"M7 2c0 4 5 4 5 8s-6 4-6 8 3 4 3 4\"/><path d=\"M13 2c0 4 5 4 5 8s-6 4-6 8 3 4 3 4\"/>",
	forest: "<path d=\"M12 2l6 9h-3.5l4.5 7H5l4.5-7H6z\"/><path d=\"M12 18v4\"/>",
	dams: "<path d=\"M3 6h18\"/><path d=\"M6 6l-2 15h16L18 6\"/><path d=\"M9 11h6M8.5 15.5h7\"/>",
	snow: "<path d=\"M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7\"/><path d=\"M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5\"/>",
	labels: "<path d=\"M3 12V4h8l10 10-8 8z\"/><circle cx=\"7.5\" cy=\"8.5\" r=\"1.5\"/>",
};
const icon = (id) => `<svg class="layer-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>`;

// Each layer switches real scene objects in view3d.js (setLayer). Only the labels layer has
// an opacity slider: it is the one layer whose opacity can change without new shaders.
export const LAYERS = [
	{ id: "terrain", name: "Terrain (3D)" },
	{ id: "reservoirs", name: "Reservoir levels" },
	{ id: "rivers", name: "Rivers & outflows" },
	{ id: "forest", name: "Riverside trees" },
	{ id: "dams", name: "Dams & spillways" },
	{ id: "snow", name: "Snowpack" },
	{ id: "labels", name: "Labels", opacity: true },
];

export function createLayers(el, view3d, store) {
	el.innerHTML = `
		<ul class="layer-list">
			${LAYERS.map((l) => `
				<li class="layer-row" data-layer="${l.id}">
					<label class="layer-name"><input type="checkbox" checked data-layer-toggle="${l.id}">
						${icon(l.id)}<span>${l.name}</span></label>
					${l.opacity ? `<input type="range" class="layer-opacity" min="0" max="100" value="100" aria-label="${l.name} opacity"><span class="layer-val num">100%</span>` : ""}
				</li>`).join("")}
		</ul>
		<p class="layer-note">Layers apply to the 3D view.</p>`;
	el.querySelectorAll("[data-layer-toggle]").forEach((cb) => cb.addEventListener("change", () => {
		view3d.setLayer(cb.dataset.layerToggle, cb.checked);
		cb.closest(".layer-row").classList.toggle("off", !cb.checked);
	}));
	const op = el.querySelector(".layer-opacity");
	if (op) {
		op.addEventListener("input", () => {
			view3d.setLabelOpacity(op.value / 100);
			op.nextElementSibling.textContent = `${op.value}%`;
		});
	}
	const sync = (mode) => {
		el.classList.toggle("is-2d", mode === "2d");
		el.querySelectorAll("input").forEach((i) => (i.disabled = mode === "2d"));
	};
	store.subscribe((s, changed) => changed.includes("mode") && sync(s.mode));
	sync(store.get().mode);
}

// Key/value card for the selected reservoir; every value comes from the loaded data.
export function createReservoirCard(el, data, store) {
	const basinOf = new Map();
	for (const l of data.links) if (l.gauge && !basinOf.has(l.reservoir.id)) basinOf.set(l.reservoir.id, l.gauge);
	function render({ selected, dateIndex }) {
		const r = selected && data.byId.get(selected);
		if (!r) {
			el.innerHTML = "<p class=\"card-empty\">Click a lake on the map, or a name under Largest reservoirs, to see its numbers here.</p>";
			return;
		}
		const pct = pctAt(r, dateIndex);
		const oa = ofAvgAt(data, r, dateIndex);
		const g = basinOf.get(r.id);
		const color = markColor(r, pct);
		const status = r.floodControl ? [ "Flood control", "flood" ] : pct === null ? [ "No data", "none" ] : pct < 0.4 ? [ "Below 40% full", "low" ] : oa !== null && oa >= 1 ? [ "Above average", "high" ] : [ "Below average", "mid" ];
		const rows = [
			[ "Reservoir", r.name ],
			[ "ID", r.id ],
			[ "County", r.county ],
			[ "Dam", `${DAM_TYPES[damTypeOf(r)]}${r.yearBuilt ? `, built ${r.yearBuilt}` : ""}` ],
			[ "River basin", g ? `${g.basin} (gauge ${g.id})` : "—" ],
			[ "Capacity", fmtAF(r.capacity) ],
			[ `Storage, ${fmtMonth(data.dates[dateIndex])}`, fmtAF(r.series[dateIndex]) ],
			[ "Of capacity", fmtPct(pct) ],
			[ "Of average", oa === null ? "—" : `${fmtPct(oa)} (${data.avgYears.from}–${String(data.avgYears.to).slice(2)})` ],
		];
		el.innerHTML = `<dl class="kv">${rows.map(([ k, v ]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}
			<dt>Status</dt><dd><span class="pill pill-${status[1]}"${color ? ` style="--pill:${color}"` : ""}>${status[0]}</span></dd></dl>`;
	}
	store.subscribe((s, changed) => {
		if (changed.includes("selected") || changed.includes("dateIndex")) render(s);
	});
	render(store.get());
}
