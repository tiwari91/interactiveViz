// Geometry for the wood view, after Yoon Chung Han's laser-cut wooden sculptures (2016):
// stacked birch layers cut along the terrain, with walnut where the reservoirs are low.
//  - Terrain layers: contours of the ETOPO elevation grid inside California.
//  - Walnut: where nearby reservoirs hold less than DRY_BELOW of their usual level for the
//    calendar month. Between reservoirs the value is spread by distance (drawn, not mapped).
// Everything is returned in lon/lat rings; callers project them (screen, thumbnails, cut file).
import { loadElevation, californiaMask } from "../three/world.js";
import { ofAvgAt } from "../data.js";

const d3 = window.d3;

// Layer heights in metres. The base sheet is the state outline itself.
export const LAYER_M = [ 300, 800, 1400, 2100, 2900 ];
// Walnut below this share of the usual level for the month.
export const DRY_BELOW = 0.8;
// Dark walnut below this share: the worst-hit areas.
export const DEEP_BELOW = 0.55;
// Drop pieces smaller than this many grid cells: crumbs a laser cutter can't use.
const MIN_CELLS = 10;

function ringArea(ring) {
	let a = 0;
	for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
	return Math.abs(a / 2);
}

// d3.contours MultiPolygon in grid units -> list of polygons (rings) in lon/lat, small bits dropped.
function toLonLat(geom, g, step) {
	const dlat = (g.north - g.south) / (g.rows - 1);
	const dlon = (g.east - g.west) / (g.cols - 1);
	const out = [];
	for (const poly of geom.coordinates) {
		if (ringArea(poly[0]) < MIN_CELLS / (step * step)) continue;
		out.push(poly.filter((ring, k) => k === 0 || ringArea(ring) >= MIN_CELLS / (step * step))
			.map((ring) => ring.map(([ x, y ]) => [ g.west + (x - 0.5) * step * dlon, g.north - (y - 0.5) * step * dlat ])));
	}
	return out;
}

function blur(src, w, h, r) {
	const out = new Float32Array(src.length);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0, n = 0;
			for (let dy = -r; dy <= r; dy++) {
				const yy = Math.min(h - 1, Math.max(0, y + dy));
				for (let dx = -r; dx <= r; dx++) {
					s += src[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
					n++;
				}
			}
			out[y * w + x] = s / n;
		}
	}
	return out;
}

export async function createWoodField(data) {
	const elev = await loadElevation("low");
	const { rows, cols } = elev;
	const { mask } = californiaMask(data, elev);

	// Terrain: smooth the grid a little so cut lines are flowing curves, keep only California.
	const smooth = blur(Float32Array.from(elev.data), cols, rows, 1);
	for (let i = 0; i < smooth.length; i++) if (mask[i] < 0.5) smooth[i] = -1000;
	const layers = d3.contours().size([ cols, rows ]).thresholds(LAYER_M)(smooth)
		.map((geom, k) => ({ metres: LAYER_M[k], polys: toLonLat(geom, elev, 1) }))
		.filter((l) => l.polys.length);

	// Dry field on a coarser grid (every STEP cells) so a month takes a few milliseconds.
	const STEP = 2;
	const fw = Math.ceil(cols / STEP), fh = Math.ceil(rows / STEP);
	const dlat = (elev.north - elev.south) / (rows - 1);
	const dlon = (elev.east - elev.west) / (cols - 1);
	const cells = [];
	for (let y = 0; y < fh; y++) {
		for (let x = 0; x < fw; x++) {
			const gx = Math.min(cols - 1, x * STEP), gy = Math.min(rows - 1, y * STEP);
			cells.push({ lon: elev.west + gx * dlon, lat: elev.north - gy * dlat, inside: mask[gy * cols + gx] >= 0.5 });
		}
	}
	const sites = data.reservoirs.filter((r) => r.hasData && !r.floodControl);
	const cache = new Map();

	// Share of the usual level at each cell: capacity-weighted, falling off with distance, pulled
	// toward the statewide figure far from any reservoir (the deserts have none).
	function fieldAt(i) {
		const state = data.totals[i].ofAvg ?? 1;
		const vals = sites.map((r) => ({ r, v: ofAvgAt(data, r, i) })).filter((s) => s.v !== null);
		const f = new Float32Array(cells.length);
		cells.forEach((c, k) => {
			if (!c.inside) { f[k] = -10; return; }
			const kx = Math.cos(c.lat * Math.PI / 180);
			let s = state * 1e-3, w = 1e-3;
			for (const { r, v } of vals) {
				const d2 = ((r.lon - c.lon) * kx) ** 2 + (r.lat - c.lat) ** 2;
				const wt = (r.capacity / 1e5) ** 0.35 / (d2 + 0.03) ** 1.6;
				s += Math.min(1.6, v) * wt;
				w += wt;
			}
			f[k] = -(s / w); // negated: contour at -DRY_BELOW gives the area below it
		});
		return f;
	}

	return {
		layers,
		// Walnut polygons (lon/lat) for a month, below DRY_BELOW or DEEP_BELOW of the usual level.
		// Both levels come from one pass over the field; only the shapes are kept.
		dryAt(i, below = DRY_BELOW) {
			if (!cache.has(i)) {
				const [ dry, deep ] = d3.contours().size([ fw, fh ]).thresholds([ -DRY_BELOW, -DEEP_BELOW ])(fieldAt(i));
				cache.set(i, { [DRY_BELOW]: toLonLat(dry, elev, STEP), [DEEP_BELOW]: toLonLat(deep, elev, STEP) });
			}
			const shapes = cache.get(i)[below];
			if (!shapes) throw new Error(`dryAt: no walnut level ${below}`);
			return shapes;
		},
	};
}

// Project lon/lat polygons through any (lon, lat) -> [x, y] function into an SVG path string.
export function pathOf(polys, project) {
	let d = "";
	for (const poly of polys) {
		for (const ring of poly) {
			ring.forEach((p, k) => {
				const [ x, y ] = project(p);
				d += `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
			});
			d += "Z";
		}
	}
	return d;
}

// Rough share of California's area that is walnut this month, 0..1 (for tests and labels).
export function areaShare(polys, outlineArea, project) {
	let a = 0;
	for (const poly of polys) {
		poly.forEach((ring, k) => {
			const pr = ring.map(project);
			a += (k ? -1 : 1) * ringArea(pr);
		});
	}
	return outlineArea ? a / outlineArea : 0;
}
