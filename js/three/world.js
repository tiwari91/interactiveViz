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
	return { ...grid, data: new Int16Array(buf), surround: { ...sur, data: new Int16Array(sbuf) } };
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
