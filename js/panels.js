// Sidebar panels: the 3D Layers list and the selected reservoir's key/value card.
import { pctAt, ofAvgAt } from "./data.js";
import { markColor, fmtAF, fmtPct, fmtMonth } from "./scales.js";
import { DAM_TYPES, damTypeOf } from "./three/damTypes.js";

// Each layer switches real scene objects in view3d.js (setLayer). Only the labels layer has
// an opacity slider: it is the one layer whose opacity can change without new shaders.
export const LAYERS = [
	{ id: "terrain", name: "Terrain (3D)", swatch: "linear-gradient(135deg,#c9b48f,#8a7a5c)" },
	{ id: "reservoirs", name: "Reservoir levels", swatch: "linear-gradient(135deg,#4f9fd1,#1d5fa3)" },
	{ id: "rivers", name: "Rivers & outflows", swatch: "linear-gradient(90deg,#9cc9e8,#2f86c4)" },
	{ id: "forest", name: "Riverside trees", swatch: "linear-gradient(135deg,#7f9a5a,#3f5a32)" },
	{ id: "dams", name: "Dams & spillways", swatch: "linear-gradient(135deg,#d8d2c4,#9a9283)" },
	{ id: "labels", name: "Labels", swatch: "linear-gradient(135deg,#fffdf8,#c2410c)", opacity: true },
];

export function createLayers(el, view3d, store) {
	el.innerHTML = `
		<ul class="layer-list">
			${LAYERS.map((l) => `
				<li class="layer-row" data-layer="${l.id}">
					<label class="layer-name"><input type="checkbox" checked data-layer-toggle="${l.id}">
						<span class="layer-swatch" style="background:${l.swatch}"></span><span>${l.name}</span></label>
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
