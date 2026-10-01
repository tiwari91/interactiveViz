// Everything month-dependent in the 3D scene, as plain arrays: lake levels and
// tints, dam releases, river widths and how dry the land looks.
import { colorFor, flowScale } from "../scales.js";
import { flowAt } from "../data.js";

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export function createSnapshots(data, basins, foamSpots, rivers) {
	const linkedFlow = new Map();
	for (const l of data.links) {
		if (!l.gauge.flow) continue;
		const list = linkedFlow.get(l.reservoir.id) ?? [];
		list.push(l.gauge);
		linkedFlow.set(l.reservoir.id, list);
	}
	const index = new Map(basins.basins.map((b, i) => [ b.r.id, i ]));
	const cache = new Map();

	function releaseOf(r, i, pct) {
		const gauges = linkedFlow.get(r.id) ?? [];
		const boost = gauges.reduce((m, g) => Math.max(m, flowScale(flowAt(g, i) ?? 0)), 0);
		const p = pct ?? 0;
		return {
			outlet: pct === null ? 0 : Math.min(1, 0.12 + 0.45 * smoothstep(0.25, 0.95, p) + 0.45 * boost),
			spill: smoothstep(0.9, 0.985, p),
		};
	}

	return function snapshot(i) {
		if (cache.has(i)) return cache.get(i);
		const levels = [];
		const tints = [];
		const visible = [];
		const pcts = [];
		const release = [];
		for (const b of basins.basins) {
			const v = b.r.series[i];
			const pct = v === null ? null : v / b.r.capacity;
			pcts.push(pct);
			levels.push(b.levelFor(pct));
			tints.push(colorFor(pct));
			visible.push(pct !== null && pct > 0.003);
			release.push(releaseOf(b.r, i, pct));
		}
		const foam = foamSpots.map((s) => {
			const rel = release[index.get(s.id)];
			return s.kind === "spill" ? rel.spill : rel.outlet;
		});
		const statewide = data.totals[i].pct;
		const snap = {
			levels,
			tints,
			visible,
			pcts,
			release,
			foam,
			widths: rivers.widthsFor(i),
			// Land browns as statewide storage falls from ~75% toward ~30%.
			dryness: 1 - smoothstep(0.32, 0.72, statewide),
		};
		cache.set(i, snap);
		return snap;
	};
}
