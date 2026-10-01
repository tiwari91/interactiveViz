// Shared scales, formatters and geometry helpers for the 2D and 3D views.
const d3 = window.d3;

// Percent full -> drought severity. Warm = low storage, blue = full.
export const PCT_STOPS = [ 0, 0.25, 0.5, 0.75, 1 ];
export const PCT_COLORS = [ "#b2182b", "#e8743b", "#e3b448", "#5aa3cf", "#1d5fa3" ];
export const pctColor = d3.scaleLinear().domain(PCT_STOPS).range(PCT_COLORS).interpolate(d3.interpolateLab).clamp(true);
export const NO_DATA_COLOR = "#9a9a9a";

export const colorFor = (pct) => (pct === null ? NO_DATA_COLOR : pctColor(pct));

export const fmtAF = (v) => (v === null ? "—" : `${d3.format(",.0f")(v)} AF`);
export const fmtMAF = (v) => `${d3.format(".2f")(v / 1e6)}M AF`;
export const fmtPct = (v) => (v === null ? "—" : d3.format(".0%")(v));
export const fmtCfs = (v) => (v === null ? "—" : `${d3.format(",.0f")(v)} cfs`);
export const fmtMonth = d3.timeFormat("%b %Y");
export const fmtMonthLong = d3.timeFormat("%B %Y");

// California Albers-style conic projection fitted to an extent.
export function makeProjection(outline, width, height, pad = 16) {
	return d3.geoConicEqualArea()
		.parallels([ 34, 40.5 ])
		.rotate([ 120, 0 ])
		.fitExtent([ [ pad, pad ], [ width - pad, height - pad ] ], outline);
}

// Deterministic PRNG so a stream keeps its shape across redraws and views.
function seeded(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
}

// A meandering river-like polyline between two projected points.
// Keeps the 2016 idea of irregular "stream" lines, minus the per-redraw randomness.
export function meander(key, [ x0, y0 ], [ x1, y1 ], segments = 16) {
	const rand = seeded(key);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	const amp = Math.min(len * 0.08, 18);
	const bow = (rand() - 0.5) * len * 0.18;
	const pts = [];
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const taper = Math.sin(Math.PI * t);
		const wiggle = (rand() - 0.5) * 2 * amp * taper;
		const off = bow * taper + wiggle;
		pts.push([ x0 + dx * t + nx * off, y0 + dy * t + ny * off ]);
	}
	return pts;
}

// Flow (cfs) -> stroke width factor 0..1 (sqrt so small rivers stay visible).
export const flowScale = d3.scaleSqrt().domain([ 0, 40000 ]).range([ 0.15, 1 ]).clamp(true);

// Reservoirs big enough to label.
export const MAJOR_CAPACITY = 1_000_000;
