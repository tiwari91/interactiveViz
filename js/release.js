// Data-driven dam activity for a month, shared by the 3D scene (white water) and
// the sound engine (dam voices). Release is estimated from how full the lake is
// plus the linked gauges' measured flow; the spillway runs above ~90% full.
import { flowAt } from "./data.js";
import { flowScale } from "./scales.js";

export const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

export function createRelease(data) {
	const linked = new Map();
	for (const l of data.links) {
		if (!l.gauge.flow) continue;
		const list = linked.get(l.reservoir.id) ?? [];
		list.push(l.gauge);
		linked.set(l.reservoir.id, list);
	}
	const maxCap = Math.max(...data.reservoirs.map((r) => r.capacity));
	const minCap = Math.min(...data.reservoirs.map((r) => r.capacity));
	const cache = new Map();

	function releaseOf(r, i) {
		const v = r.series[i];
		const pct = v === null ? null : v / r.capacity;
		const boost = (linked.get(r.id) ?? []).reduce((m, g) => Math.max(m, flowScale(flowAt(g, i) ?? 0)), 0);
		const p = pct ?? 0;
		return {
			pct,
			outlet: pct === null ? 0 : Math.min(1, 0.12 + 0.45 * smoothstep(0.25, 0.95, p) + 0.45 * boost),
			spill: pct === null ? 0 : smoothstep(0.9, 0.985, p),
		};
	}

	// Sound "voice" for each dam this month, 0..1, on perceptual curves:
	// volume of water = sqrt(storage / largest capacity), voice size = log of capacity.
	function voicesAt(i) {
		if (cache.has(i)) return cache.get(i);
		const out = new Map();
		for (const r of data.reservoirs) {
			const rel = releaseOf(r, i);
			const storage = r.series[i] ?? 0;
			const volume = Math.sqrt(Math.min(1, storage / maxCap));
			const size = Math.log(r.capacity / minCap) / Math.log(maxCap / minCap);
			const level = rel.pct === null ? 0 : Math.min(1, (0.6 * volume + 0.4 * rel.outlet) * (0.3 + 0.7 * size));
			out.set(r.id, { level, size, volume, outlet: rel.outlet, spill: rel.spill, pct: rel.pct });
		}
		cache.set(i, out);
		return out;
	}

	return { releaseOf, voicesAt };
}
