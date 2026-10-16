// World frame for the 3D view: geographic projection to the XZ plane plus a
// bilinear elevation sampler over the ETOPO grid, with vertical exaggeration.
import { makeProjection } from "../scales.js";

const d3 = window.d3;
export const WORLD = 1000;
export const EXAGGERATION = 7;
export const SEA_Y = 0;

export async function loadElevation(quality, base = "data/") {
	const meta = await d3.json(`${base}elevation.json`);
	const grid = meta.grids[quality === "high" ? "1m" : "2m"];
	const sur = meta.grids.surround;
	const [ buf, sbuf ] = await Promise.all([ d3.buffer(`${base}${grid.file}`), d3.buffer(`${base}${sur.file}`) ]);
	return { ...grid, data: decodeGrid(buf, grid), surround: { ...sur, data: decodeGrid(sbuf, sur) } };
}

// Grids are stored "grad-planes-v1" (see scripts/fetch_elevation.py): residuals from a
// left + up - upleft predictor, low bytes then high bytes. Raw int16 grids still load.
export function decodeGrid(buf, { rows, cols, encoding }) {
	if (encoding !== "grad-planes-v1") return new Int16Array(buf);
	const b = new Uint8Array(buf);
	const n = rows * cols;
	const out = new Int16Array(n);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const i = r * cols + c;
			const pred = r && c ? out[i - 1] + out[i - cols] - out[i - cols - 1] : c ? out[i - 1] : r ? out[i - cols] : 0;
			out[i] = pred + (b[i] | (b[n + i] << 8)); // Int16Array wraps like the encoder's & 0xFFFF
		}
	}
	return out;
}

export function createWorld(data, elev) {
	const geo = makeProjection(data.outline, WORLD, WORLD, 0);
	const half = WORLD / 2;
	const project = ([ lon, lat ]) => {
		const [ x, y ] = geo([ lon, lat ]);
		return [ x - half, y - half ];
	};
	const unproject = (x, z) => geo.invert([ x + half, z + half ]);

	// World units per kilometre, measured north-south through the middle of the state.
	const a = project([ -119.5, 36 ]);
	const b = project([ -119.5, 37 ]);
	const unitsPerKm = Math.hypot(b[0] - a[0], b[1] - a[1]) / 111.2;
	const vscale = (unitsPerKm / 1000) * EXAGGERATION;

	const { rows, cols, north, south, west, east, data: z } = elev;
	despike(z, rows, cols);
	if (!z.pitsFilled) {
		fillPits(z, rows, cols);
		// Filling next to a deep closed basin can leave a step; smooth any such spike again.
		z.despiked = false;
		despike(z, rows, cols);
	}
	const dlat = (north - south) / (rows - 1);
	const dlon = (east - west) / (cols - 1);

	function metresAt(lon, lat) {
		const fr = Math.min(rows - 1.001, Math.max(0, (north - lat) / dlat));
		const fc = Math.min(cols - 1.001, Math.max(0, (lon - west) / dlon));
		const r = Math.floor(fr);
		const c = Math.floor(fc);
		const tr = fr - r;
		const tc = fc - c;
		const i = r * cols + c;
		const top = z[i] * (1 - tc) + z[i + 1] * tc;
		const bot = z[i + cols] * (1 - tc) + z[i + cols + 1] * tc;
		return top * (1 - tr) + bot * tr;
	}

	// Land sits just above the sea plane; the sea floor is flattened out of sight.
	const toY = (m) => (m > 0 ? 0.25 + m * vscale : -1.5 + Math.max(m, -300) * vscale * 0.2);

	return {
		geo,
		project,
		unproject,
		unitsPerKm,
		vscale,
		elev,
		dlat,
		dlon,
		metresAt,
		toY,
		// Ground height (world units) under a world XZ point, before reservoir carving.
		groundY(x, zz) {
			const [ lon, lat ] = unproject(x, zz);
			return toY(metresAt(lon, lat));
		},
	};
}

// At 7x vertical exaggeration a lone DEM cell that stands far above or below its four
// neighbours renders as a needle or shard. Pull such cells back toward the local mean
// (land only, once per grid; already-clamped grids are left as they are).
// Shallow pits in the elevation grid (the coarse DEM leaves narrow river canyons blocked by
// small sills) are filled up to their spill point with a tiny fall toward it, so water drawn
// downhill always finds its way out, as the real river does. Deep closed basins (the Tulare
// lake bed, Salton Sea, Death Valley) are left alone: rivers really end there.
export const PIT_FILL_M = 250;
function fillPits(z, rows, cols) {
	if (z.pitsFilled) return;
	const n = rows * cols;
	const orig = Float32Array.from(z);
	const done = new Uint8Array(n);
	const heap = new Int32Array(n);
	let size = 0;
	const less = (a, b) => z[a] < z[b];
	const push = (i) => {
		let c = size++;
		heap[c] = i;
		while (c > 0) {
			const p = (c - 1) >> 1;
			if (!less(heap[c], heap[p])) break;
			const t = heap[c]; heap[c] = heap[p]; heap[p] = t;
			c = p;
		}
	};
	const pop = () => {
		const top = heap[0];
		heap[0] = heap[--size];
		let c = 0;
		for (;;) {
			const l = c * 2 + 1;
			const r = l + 1;
			let m = c;
			if (l < size && less(heap[l], heap[m])) m = l;
			if (r < size && less(heap[r], heap[m])) m = r;
			if (m === c) break;
			const t = heap[c]; heap[c] = heap[m]; heap[m] = t;
			c = m;
		}
		return top;
	};
	for (let i = 0; i < n; i++) {
		const r = Math.floor(i / cols);
		const c = i % cols;
		if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || orig[i] <= 0) {
			done[i] = 1;
			push(i);
		}
	}
	const EPS = 0.05;
	while (size) {
		const i = pop();
		const r = Math.floor(i / cols);
		const c = i % cols;
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				if (!dr && !dc) continue;
				const rr = r + dr;
				const cc = c + dc;
				if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
				const j = rr * cols + cc;
				if (done[j]) continue;
				done[j] = 1;
				const fill = z[i] + EPS;
				if (orig[j] < fill && fill - orig[j] <= PIT_FILL_M) z[j] = fill;
				push(j);
			}
		}
	}
	z.pitsFilled = true;
}

export const SPIKE_M = 220;
function despike(z, rows, cols) {
	if (z.despiked) return;
	// Clamping a cell moves its neighbours' means, so repeat until nothing moves.
	for (let pass = 0; pass < 12; pass++) {
		const src = Int16Array.from(z);
		let moved = 0;
		for (let r = 1; r < rows - 1; r++) {
			for (let c = 1; c < cols - 1; c++) {
				const i = r * cols + c;
				if (src[i] <= 0) continue;
				const m = (src[i - 1] + src[i + 1] + src[i - cols] + src[i + cols]) / 4;
				const d = src[i] - m;
				if (d > SPIKE_M) z[i] = Math.floor(m + SPIKE_M);
				else if (d < -SPIKE_M) z[i] = Math.ceil(m - SPIKE_M);
				if (z[i] !== src[i]) moved++;
			}
		}
		if (!moved) break;
	}
	z.despiked = true;
}

// Rasterise the state outline onto the elevation grid: 1 inside California, 0 outside,
// plus a blurred copy used to fade neighbouring states softly.
export function californiaMask(data, elev) {
	const { rows, cols, north, west } = elev;
	const dlat = (elev.north - elev.south) / (rows - 1);
	const dlon = (elev.east - elev.west) / (cols - 1);
	const canvas = document.createElement("canvas");
	canvas.width = cols;
	canvas.height = rows;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const toGrid = d3.geoTransform({
		point(lon, lat) {
			this.stream.point((lon - west) / dlon + 0.5, (north - lat) / dlat + 0.5);
		},
	});
	ctx.fillStyle = "#fff";
	ctx.beginPath();
	d3.geoPath(toGrid, ctx)(data.outline);
	ctx.fill();
	const px = ctx.getImageData(0, 0, cols, rows).data;
	const mask = new Float32Array(rows * cols);
	for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] / 255;
	return { mask, soft: boxBlur(mask, cols, rows, Math.max(2, Math.round(cols / 120))) };
}

function boxBlur(src, w, h, r) {
	const tmp = new Float32Array(src.length);
	const out = new Float32Array(src.length);
	const n = 2 * r + 1;
	for (let y = 0; y < h; y++) {
		let acc = 0;
		for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
		for (let x = 0; x < w; x++) {
			tmp[y * w + x] = acc / n;
			acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
		}
	}
	for (let x = 0; x < w; x++) {
		let acc = 0;
		for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
		for (let y = 0; y < h; y++) {
			out[y * w + x] = acc / n;
			acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
		}
	}
	return out;
}

// Small deterministic value noise for colour and shape variation.
export function hash2(x, y) {
	let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x, y) {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const tx = x - xi;
	const ty = y - yi;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const a = hash2(xi, yi);
	const b = hash2(xi + 1, yi);
	const c = hash2(xi, yi + 1);
	const d = hash2(xi + 1, yi + 1);
	return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export function fbm(x, y, oct = 4) {
	let v = 0;
	let amp = 0.5;
	let f = 1;
	for (let i = 0; i < oct; i++) {
		v += amp * noise2(x * f, y * f);
		f *= 2.03;
		amp *= 0.5;
	}
	return v;
}
