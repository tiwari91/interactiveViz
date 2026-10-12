// Everything month-dependent in the 3D scene, as plain arrays: lake levels and
// tints, dam releases, river widths and how dry the land looks.
import { markColor, NO_DATA_COLOR } from "../scales.js";
import { createRelease, smoothstep } from "../release.js";

// How far the grass has cured by calendar month (0 = January), in an average year.
const SEASON = [ 0.25, 0.15, 0.05, 0, 0.1, 0.45, 0.8, 1, 1, 0.9, 0.65, 0.4 ];

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
			tints.push(markColor(b.r, pct) ?? NO_DATA_COLOR); // invisible when null
			visible.push(pct !== null && pct > 0.003);
			release.push(releaseOf(b.r, i));
		}
		const foam = foamSpots.map((s) => {
			const rel = release[index.get(s.id)];
			// Tailrace pool is always visible while the lake holds water.
			return s.kind === "spill" ? rel.spill : rel.pct === null || rel.outlet <= 0 ? 0 : 0.35 + 0.65 * rel.outlet;
		});
		const statewide = data.totals[i].pct;
		// Land browns as statewide storage falls from ~75% toward ~30%.
		const dryness = 1 - smoothstep(0.32, 0.72, statewide);
		const snap = {
			levels,
			tints,
			visible,
			pcts,
			release,
			foam,
			outlet: release.map((r) => r.outlet),
			spill: release.map((r) => r.spill),
			dryness,
			// Grass: green in a wet spring, golden through a dry summer and autumn.
			gold: Math.min(1, SEASON[data.calMonth[i]] * (0.55 + 0.6 * dryness) + dryness * 0.25),
		};
		cache.set(i, snap);
		return snap;
	};
}
