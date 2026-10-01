// Everything month-dependent in the 3D scene, as plain arrays: lake levels and
// tints, dam releases, river widths and how dry the land looks.
import { colorFor } from "../scales.js";
import { createRelease, smoothstep } from "../release.js";

export function createSnapshots(data, basins, foamSpots) {
	const { releaseOf: rel } = createRelease(data);
	const index = new Map(basins.basins.map((b, i) => [ b.r.id, i ]));
	const cache = new Map();
	const releaseOf = (r, i) => rel(r, i);

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
			release.push(releaseOf(b.r, i));
		}
		const foam = foamSpots.map((s) => {
			const rel = release[index.get(s.id)];
			// Tailrace pool is always visible while the lake holds water.
			return s.kind === "spill" ? rel.spill : rel.pct === null || rel.outlet <= 0 ? 0 : 0.35 + 0.65 * rel.outlet;
		});
		const statewide = data.totals[i].pct;
		const snap = {
			levels,
			tints,
			visible,
			pcts,
			release,
			foam,
			outlet: release.map((r) => r.outlet),
			spill: release.map((r) => r.spill),
			// Land browns as statewide storage falls from ~75% toward ~30%.
			dryness: 1 - smoothstep(0.32, 0.72, statewide),
		};
		cache.set(i, snap);
		return snap;
	};
}
