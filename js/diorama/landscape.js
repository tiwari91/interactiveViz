// The landscape slice inside the case: a stylised California seen from the coast, north to the
// left and the Sierra Nevada at the back. Lakes are carved bowls whose positions follow the
// real reservoirs loosely; rivers are carved channels. Everything is deterministic.
import { noise2, fbm, hash2 } from "../three/world.js";

export const BOX = { w: 12, d: 7.5, base: -1.5 };
export const FRONT = BOX.d / 2;
const HX = BOX.w / 2;

// Lakes, north (left) to south (right). r = mean radius, a = elongation, rot = bowl rotation,
// out = outlet direction (radians, 0 = +x, PI/2 = toward the front). Trinity is cut by the front
// face so its water shows in section.
const LAYOUT = [
	{ id: "CLE", x: -4.1, z: 3.62, rot: 0.12, out: 0.05, inflow: [ -4.9, -0.6 ] },
	{ id: "SHA", x: -2.45, z: 0.55, rot: -0.35, out: 1.3, inflow: [ -3.0, -2.2 ] },
	{ id: "ALM", x: -1.6, z: -2.15, rot: 0.35, out: 0.9, outTo: "ORO", inflow: [ -1.1, -3.6 ] },
	{ id: "BER", x: -1.05, z: 2.75, rot: 0.5, out: 1.75, inflow: null },
	{ id: "ORO", x: -0.55, z: -0.35, rot: 0.15, out: 1.55, inflow: "falls" },
	{ id: "BUL", x: 0.95, z: -1.75, rot: 0.9, out: 1.9, inflow: [ 1.5, -3.6 ] },
	{ id: "FOL", x: 1.15, z: 1.25, rot: -0.2, out: 1.6, inflow: [ 1.9, -0.6 ] },
	{ id: "NML", x: 2.75, z: -0.15, rot: 0.35, out: 1.45, inflow: [ 3.1, -3.4 ] },
	{ id: "DNP", x: 3.45, z: 1.85, rot: -0.4, out: 1.7, inflow: [ 4.1, 0.6 ] },
	{ id: "PNF", x: 4.85, z: -0.55, rot: 0.6, out: 1.6, inflow: [ 5.3, -3.4 ] },
];

// The cliff and waterfall that feed Oroville (Feather Falls is in that basin).
export const FALLS = { x: -0.62, top: -1.62, lip: -1.38 };
const MT_SHASTA = [ -3.55, -2.55 ];

const smooth = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const ridged = (x, z) => 1 - Math.abs(noise2(x, z) * 2 - 1);

function base(x, z) {
	const back = smooth(2.4, -3.5, z); // 0 in the valley at the front, 1 at the Sierra crest
	let h = 0.14 + back * back * 2.15 + back * 0.3;
	// Coast ranges and Klamath mountains at the front left.
	const coast = Math.exp(-((x + 3.6) ** 2) / 5.5) * smooth(0.6, 3.2, z) * 0.7;
	h += coast;
	const n = fbm(x * 0.55 + 11.3, z * 0.55 + 3.1, 5) - 0.5;
	let r = ridged(x * 0.85 + 4.2, z * 0.85 - 1.7);
	r = r * r * 0.7 + ridged(x * 1.7 - 3, z * 1.7 + 5) ** 2 * 0.1;
	h += n * (0.3 + back * 0.55 + coast * 0.6) + r * (back * 0.95 + coast * 0.45);
	// Mount Shasta: a lone volcano at the back left.
	const ds = Math.hypot(x - MT_SHASTA[0], (z - MT_SHASTA[1]) * 1.1);
	h += Math.max(0, 1 - ds / 1.6) ** 1.5 * 1.35;
	// A granite step behind Oroville for the falls.
	const step = smooth(FALLS.lip - 0.12, FALLS.top + 0.02, z) * Math.exp(-((x - FALLS.x) ** 2) / 0.35);
	h += step * 0.75;
	return h;
}

// Lake bowl geometry in its own frame.
function bowlFrame(L, x, z) {
	const dx = x - L.x;
	const dz = z - L.z;
	const c = Math.cos(L.rot);
	const s = Math.sin(L.rot);
	const lx = dx * c + dz * s;
	const lz = -dx * s + dz * c;
	const th = Math.atan2(lz, lx);
	return { th, dist: Math.hypot(lx, lz) };
}

function radiusAt(L, th) {
	// Elongated with a few arms, like a flooded river valley.
	const ell = 1 / Math.sqrt((Math.cos(th) / L.a) ** 2 + (Math.sin(th) * L.a) ** 2);
	return L.r * ell * (1 + 0.16 * Math.sin(3 * th + L.ph) + 0.09 * Math.sin(5 * th + L.ph * 2.1));
}

export function lakeD(L, x, z) {
	const f = bowlFrame(L, x, z);
	return f.dist / radiusAt(L, f.th);
}

// Densely sampled polyline helpers.
function catmull(points, step = 0.035) {
	const out = [];
	const p = [ points[0], ...points, points[points.length - 1] ];
	for (let i = 1; i < p.length - 2; i++) {
		const [ p0, p1, p2, p3 ] = [ p[i - 1], p[i], p[i + 1], p[i + 2] ];
		const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
		for (let k = 0; k < n; k++) {
			const t = k / n;
			const t2 = t * t;
			const t3 = t2 * t;
			const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
			out.push([ f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]) ]);
		}
	}
	out.push(points[points.length - 1]);
	return out;
}

export function createLandscape(data) {
	const maxCap = Math.max(...LAYOUT.map((l) => data.byId.get(l.id)?.capacity ?? 0));
	const lakes = LAYOUT.filter((l) => data.byId.get(l.id)?.hasData).map((l, i) => {
		const r = data.byId.get(l.id);
		const k = Math.sqrt(r.capacity / maxCap);
		const L = { ...l, index: i, r: 0.3 + 0.62 * k, a: 1.25 + 0.15 * k, ph: i * 1.7 + 0.4, reservoir: r };
		L.rim = Math.max(0.32, base(L.x, L.z) - 0.1);
		L.depth = 0.2 + 0.24 * k;
		return L;
	});

	// Shoreline point at an angle in world space.
	const shore = (L, th, scale = 1) => {
		const rr = radiusAt(L, th - L.rot) * scale;
		return [ L.x + Math.cos(th) * rr, L.z + Math.sin(th) * rr ];
	};

	// Rivers: inflows from the crest into each lake, outflows from each dam to the front.
	const rivers = [];
	for (const L of lakes) {
		const dam = shore(L, L.out, 1.06);
		const toe = shore(L, L.out, 1.22);
		const wig = (t) => Math.sin(t * 9 + L.index) * 0.18;
		const out = [ dam, toe ];
		const into = L.outTo && lakes.find((T) => T.id === L.outTo);
		if (into) {
			// Drains into a lake downstream (Almanor -> North Fork Feather -> Oroville).
			const th = Math.atan2(toe[1] - into.z, toe[0] - into.x);
			const inlet = shore(into, th, 0.98);
			out.push([ (toe[0] + inlet[0]) / 2 + 0.1, (toe[1] + inlet[1]) / 2 ], inlet);
		} else {
			for (let z = toe[1] + 0.45; z < FRONT + 0.2; z += 0.45) out.push([ toe[0] + wig(z) + (z - toe[1]) * 0.08, Math.min(z, FRONT + 0.05) ]);
			if (out[out.length - 1][1] < FRONT) out.push([ out[out.length - 1][0], FRONT + 0.05 ]);
		}
		rivers.push({ kind: "out", lake: L, into, pts: out, width: 0.05 + 0.03 * L.r });
		if (L.inflow === "falls") {
			rivers.push({ kind: "in", lake: L, falls: true, pts: [ [ FALLS.x - 0.35, -3.6 ], [ FALLS.x + 0.1, -2.6 ], [ FALLS.x, FALLS.top ] ], width: 0.06 });
			const th = Math.atan2(FALLS.lip - L.z, FALLS.x - L.x);
			const inlet = shore(L, th, 0.98);
			rivers.push({ kind: "in", lake: L, plunge: true, pts: [ [ FALLS.x, FALLS.lip + 0.04 ], [ (FALLS.x + inlet[0]) / 2 - 0.08, (FALLS.lip + inlet[1]) / 2 ], inlet ], width: 0.06 });
		} else if (L.inflow) {
			const src = L.inflow;
			const th = Math.atan2(src[1] - L.z, src[0] - L.x);
			const inlet = shore(L, th, 0.98);
			const mid = [ (src[0] + inlet[0]) / 2 + 0.25, (src[1] + inlet[1]) / 2 ];
			rivers.push({ kind: "in", lake: L, pts: [ src, mid, inlet ], width: 0.045 });
		}
	}
	for (const rv of rivers) rv.path = catmull(rv.pts);

	// Height profile along each river: never rising downstream.
	for (const rv of rivers) {
		const L = rv.lake;
		let run = Infinity;
		rv.prof = rv.path.map(([ x, z ], k) => {
			run = Math.min(run, base(x, z) - 0.05);
			const t = k / (rv.path.length - 1);
			if (rv.kind === "in") return rv.falls ? run : Math.max(run, L.rim - 0.02 + (1 - t) * 0.02);
			// Outflow: start below the dam crest.
			return Math.max(rv.into ? rv.into.rim - 0.02 : 0.04, Math.min(run, L.rim - 0.05 - L.depth * 0.25 - t * 0.12));
		});
		if (rv.kind === "out") {
			// Keep it monotone after the clamp.
			for (let k = 1; k < rv.prof.length; k++) rv.prof[k] = Math.min(rv.prof[k], rv.prof[k - 1]);
		}
	}

	// Nearest point on any river (squared-distance search on the dense samples, bucketed).
	const BUCKET = 0.5;
	const buckets = new Map();
	rivers.forEach((rv, ri) => rv.path.forEach(([ x, z ], k) => {
		const key = `${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`;
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push([ x, z, ri, k ]);
	}));
	function nearRiver(x, z, maxD = 0.5) {
		const bx = Math.floor(x / BUCKET);
		const bz = Math.floor(z / BUCKET);
		let best = null;
		let bd = maxD * maxD;
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				for (const s of buckets.get(`${bx + i},${bz + j}`) ?? []) {
					const d = (s[0] - x) ** 2 + (s[1] - z) ** 2;
					if (d < bd) { bd = d; best = s; }
				}
			}
		}
		return best ? { d: Math.sqrt(bd), river: rivers[best[2]], k: best[3] } : null;
	}

	function height(x, z) {
		let h = base(x, z);
		let inBowl = null;
		let protect = false;
		for (const L of lakes) {
			const d = lakeD(L, x, z);
			if (d < 1.8) {
				// Raise a bank to the rim so the bowl holds water, then let it fall away.
				// A shore apron at the rim: hills are cut down and low ground is banked up to it.
				h = L.rim + 0.035 * smooth(1, 1.1, d) + (h - L.rim) * smooth(1.08, 1.75, d) ** 1.5;
			}
			if (d < 1.06) protect = true;
			if (d < 1) inBowl = { L, d };
		}
		if (!protect) {
			const nr = nearRiver(x, z, 0.6);
			if (nr) {
				const valley = nr.river.prof[nr.k] - 0.012 + 1.5 * Math.max(0, nr.d - nr.river.width * 1.4) ** 1.1;
				h = Math.max(Math.min(h, valley), h - (z > FRONT - 1 ? 0.14 : 0.3));
			}
		}
		if (inBowl) {
			const { L, d } = inBowl;
			const n = noise2(x * 3.1 + L.index * 7, z * 3.1) - 0.5;
			h = L.rim - L.depth * (1 - d * d) ** 0.9 * (1 + n * 0.12);
		}
		return h;
	}

	return { lakes, rivers, height, base, nearRiver, shore, lakeAt(x, z) {
		for (const L of lakes) if (lakeD(L, x, z) < 1.3) return L;
		return null;
	} };
}

// Terrain heightfield mesh with snow, dryness and bathtub-ring shading.
export function createTerrainMesh(THREE, land, quality) {
	const nx = quality === "high" ? 300 : 150;
	const nz = Math.round(nx * BOX.d / BOX.w);
	const geom = new THREE.PlaneGeometry(BOX.w, BOX.d, nx, nz);
	geom.rotateX(-Math.PI / 2);
	const pos = geom.attributes.position;
	const heights = new Float32Array((nx + 1) * (nz + 1));
	const lakeIdx = new Float32Array(pos.count);
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const z = pos.getZ(i);
		const h = land.height(x, z);
		pos.setY(i, h);
		heights[i] = h;
		const L = land.lakeAt(x, z);
		lakeIdx[i] = L && lakeD(L, x, z) < 1.04 ? L.index : -1;
	}
	geom.computeVertexNormals();
	geom.setAttribute("aLake", new THREE.BufferAttribute(lakeIdx, 1));

	// Base colours by height, slope and noise; snow and dryness are added in the shader.
	const col = new Float32Array(pos.count * 3);
	const nrm = geom.attributes.normal;
	const c = new THREE.Color();
	const meadow = new THREE.Color(0x7d9b46);
	const meadow2 = new THREE.Color(0x5e8a3c);
	const forest = new THREE.Color(0x46652f);
	const rock = new THREE.Color(0x8b8780);
	const rockDark = new THREE.Color(0x5f5c58);
	const bed = new THREE.Color(0x6e5e49);
	const valley = new THREE.Color(0x9ba65a);
	const gravel = new THREE.Color(0x9a948a);
	const fieldGold = new THREE.Color(0xb4a35a);
	const fieldDark = new THREE.Color(0x4f7a34);
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		const slope = 1 - nrm.getY(i);
		const n = fbm(x * 2.3, z * 2.3, 3);
		c.copy(meadow).lerp(meadow2, n);
		if (y < 0.42 && z > 1.2) {
			// Central Valley farmland: a patchwork of fields on the flat floor.
			const fx = Math.floor(x * 2.6 + 0.5 * Math.floor(z * 3.1));
			const fz = Math.floor(z * 3.1);
			const f = hash2(fx, fz);
			const field = f < 0.33 ? valley : f < 0.6 ? meadow2 : f < 0.8 ? fieldGold : fieldDark;
			c.lerp(field, smooth(0.42, 0.24, y) * smooth(1.2, 1.7, z) * 0.85);
		}
		c.lerp(forest, smooth(0.6, 1.3, y) * 0.75);
		const rocky = Math.max(smooth(0.22, 0.42, slope + (n - 0.5) * 0.15), smooth(2.0, 2.6, y + (n - 0.5) * 0.5));
		c.lerp(n > 0.5 ? rock : rockDark, rocky);
		const L = lakeIdx[i] >= 0 ? land.lakes[lakeIdx[i]] : null;
		if (L && lakeD(L, x, z) < 1.0) c.copy(bed).lerp(gravel, n * 0.5);
		const nr = land.nearRiver(x, z, 0.12);
		if (nr && !L) c.lerp(gravel, smooth(0.12, 0.05, nr.d) * 0.6);
		col[i * 3] = c.r;
		col[i * 3 + 1] = c.g;
		col[i * 3 + 2] = c.b;
	}
	geom.setAttribute("color", new THREE.BufferAttribute(col, 3));

	const N = land.lakes.length;
	const uniforms = {
		uLevel: { value: new Array(N).fill(-10) },
		uRim: { value: land.lakes.map((L) => L.rim) },
		uSnow: { value: 3 },
		uDry: { value: 0 },
	};
	const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, uniforms);
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute float aLake;\nvarying float vLake;\nvarying vec3 vWPos;\nvarying vec3 vWN;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvLake = aLake;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", `#include <common>
varying float vLake;
varying vec3 vWPos;
varying vec3 vWN;
uniform float uLevel[${N}];
uniform float uRim[${N}];
uniform float uSnow;
uniform float uDry;
float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dn(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y);
}`)
			.replace("#include <color_fragment>", `#include <color_fragment>
{
	vec3 col = diffuseColor.rgb;
	float n = dn(vWPos.xz * 9.0) * 0.6 + dn(vWPos.xz * 31.0) * 0.4;
	// Drought: grass goes to straw.
	float green = clamp((col.g - max(col.r, col.b)) * 14.0, 0.0, 1.0);
	vec3 straw = vec3(0.27, 0.2, 0.09) * (0.8 + 0.4 * n);
	col = mix(col, straw, uDry * green * smoothstep(0.0, 2.2, 2.4 - vWPos.y) * 0.7);
	// Exposed lake bed between today's water level and the rim: the bathtub ring.
	for (int k = 0; k < ${N}; k++) {
		if (abs(vLake - float(k)) < 0.01 && vWPos.y > uLevel[k] && vWPos.y < uRim[k] + 0.03) {
			float band = 0.9 + 0.1 * sin(vWPos.y * 260.0 + n * 3.0);
			float wet = smoothstep(uLevel[k] + 0.04, uLevel[k], vWPos.y);
			vec3 ring = mix(vec3(0.34, 0.28, 0.2), vec3(0.15, 0.12, 0.09), wet) * band * (0.85 + 0.3 * n);
			col = mix(col, ring, 0.92);
		}
	}
	// Snowpack above the snow line on gentle slopes.
	// Mount Shasta keeps its glaciers through the summer.
	float line = min(uSnow, mix(2.45, 9.0, smoothstep(0.45, 0.95, length(vWPos.xz - vec2(${MT_SHASTA[0]}, ${MT_SHASTA[1]})))));
	float sn = smoothstep(line, line + 0.22, vWPos.y + (n - 0.5) * 0.35) * smoothstep(0.42, 0.72, vWN.y + (n - 0.5) * 0.2);
	col = mix(col, vec3(0.86, 0.89, 0.94), sn);
	diffuseColor.rgb = col;
}`);
	};
	const mesh = new THREE.Mesh(geom, mat);
	mesh.receiveShadow = true;
	mesh.castShadow = true;

	// Bilinear lookup in the heightfield (for particles and placement).
	const dx = BOX.w / nx;
	const dz = BOX.d / nz;
	function sample(x, z) {
		const fx = Math.min(nx - 0.001, Math.max(0, (x + HX) / dx));
		const fz = Math.min(nz - 0.001, Math.max(0, (z + FRONT) / dz));
		const i = Math.floor(fx);
		const j = Math.floor(fz);
		const tx = fx - i;
		const tz = fz - j;
		const at = (a, b) => heights[b * (nx + 1) + a];
		return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz;
	}
	function normalAt(x, z) {
		const e = 0.04;
		const hx = sample(x + e, z) - sample(x - e, z);
		const hz = sample(x, z + e) - sample(x, z - e);
		const len = Math.hypot(hx, 2 * e, hz);
		return 2 * e / len; // normal.y
	}
	return { mesh, uniforms, sample, normalAt, nx, nz };
}

// The four cut faces of the slice: soil, gravel, clay and rock strata with a groundwater band.
export function createWalls(THREE, land, terrain, quality, sectionLakes) {
	const n = quality === "high" ? 360 : 180;
	const sides = [
		// [x0, z0, x1, z1] walked so the face points outward.
		[ -HX, FRONT, HX, FRONT ],
		[ HX, FRONT, HX, -FRONT ],
		[ HX, -FRONT, -HX, -FRONT ],
		[ -HX, -FRONT, -HX, FRONT ],
	];
	const posA = [];
	const topA = [];
	const uA = [];
	const idx = [];
	let off = 0;
	let u0 = 0;
	for (const [ x0, z0, x1, z1 ] of sides) {
		const len = Math.hypot(x1 - x0, z1 - z0);
		const steps = Math.round(n * len / BOX.w);
		for (let k = 0; k <= steps; k++) {
			const t = k / steps;
			const x = x0 + (x1 - x0) * t;
			const z = z0 + (z1 - z0) * t;
			const top = terrain.sample(x, z);
			posA.push(x, top, z, x, BOX.base, z);
			topA.push(top, top);
			uA.push(u0 + t * len, u0 + t * len);
			if (k < steps) {
				const a = off + k * 2;
				idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
			}
		}
		off += (steps + 1) * 2;
		u0 += len;
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(posA, 3));
	geom.setAttribute("aTop", new THREE.Float32BufferAttribute(topA, 1));
	geom.setAttribute("aU", new THREE.Float32BufferAttribute(uA, 1));
	geom.setIndex(idx);
	geom.computeVertexNormals();

	const S = sectionLakes.length;
	const uniforms = {
		uTable: { value: -0.8 },
		uBed: { value: sectionLakes.map((L) => new THREE.Vector4(L.x, L.r * L.a * 1.3, L.rim, 0)) },
	};
	const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, uniforms);
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute float aTop;\nattribute float aU;\nvarying float vTop;\nvarying float vU;\nvarying vec3 vWPos;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvTop = aTop;\nvU = aU;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", `#include <common>
varying float vTop;
varying float vU;
varying vec3 vWPos;
uniform float uTable;
uniform vec4 uBed[${Math.max(1, S)}];
float sh1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float sn1(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(sh1(i), sh1(i + vec2(1, 0)), f.x), mix(sh1(i + vec2(0, 1)), sh1(i + vec2(1, 1)), f.x), f.y);
}
// Pebbles: one jittered disc per cell.
float pebbles(vec2 p, float r) {
	vec2 c = floor(p);
	float best = 0.0;
	for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
		vec2 g = c + vec2(float(i), float(j));
		vec2 o = vec2(sh1(g), sh1(g + 7.1));
		vec2 d = (p - g - o) * vec2(1.0, 1.5);
		float rr = r * (0.55 + 0.6 * sh1(g + 3.3));
		best = max(best, smoothstep(rr, rr * 0.7, length(d)) * (0.6 + 0.4 * sh1(g + 1.9)));
	}
	return best;
}`)
			.replace("#include <color_fragment>", `#include <color_fragment>
{
	float d = vTop - vWPos.y;
	vec2 p = vec2(vU, vWPos.y);
	float w = sn1(p * vec2(1.3, 2.0)) - 0.5;
	float n = sn1(p * 18.0);
	vec3 col;
	vec3 loam = vec3(0.10, 0.065, 0.035);
	vec3 soil = vec3(0.21, 0.13, 0.07);
	vec3 clay = vec3(0.36, 0.22, 0.11);
	vec3 rockA = vec3(0.30, 0.29, 0.28);
	vec3 rockB = vec3(0.19, 0.18, 0.18);
	vec3 bedrock = vec3(0.11, 0.105, 0.11);
	// Topsoil follows the surface; the rock strata are level beds with a gentle warp.
	if (d < 0.025) col = vec3(0.16, 0.24, 0.07);
	else if (d < 0.14 + w * 0.05) col = loam * (0.8 + 0.4 * n);
	else if (d < 0.42 + w * 0.12) {
		col = soil * (0.85 + 0.3 * n);
		float pb = pebbles(p * vec2(16.0, 16.0), 0.36);
		col = mix(col, vec3(0.42, 0.38, 0.33) * (0.7 + 0.5 * sh1(floor(p * 16.0))), pb);
	} else {
		float y = vWPos.y + w * 0.22 + vU * 0.025;
		float bands = fract(y * 2.6);
		col = mix(clay, rockA, smoothstep(0.35, 0.5, bands));
		col = mix(col, rockB, smoothstep(0.75, 0.85, bands));
		col *= 0.85 + 0.3 * n;
		float pb = pebbles(p * vec2(9.0, 9.0), 0.3) * smoothstep(-0.3, 0.2, y);
		col = mix(col, vec3(0.5, 0.47, 0.42) * (0.7 + 0.4 * n), pb * 0.85);
		col = mix(col, bedrock * (0.8 + 0.4 * n), smoothstep(-0.95, -1.15, vWPos.y + w * 0.1));
	}
	// Dark silt under a lake that the face cuts through.
	for (int k = 0; k < ${Math.max(1, S)}; k++) {
		vec4 b = uBed[k];
		if (b.y > 0.0 && abs(vWPos.x - b.x) < b.y && vTop < b.z - 0.01 && d < 0.09 && vWPos.z > 3.7) col = vec3(0.08, 0.075, 0.07) * (0.8 + 0.4 * n);
	}
	// Groundwater: the saturated zone below the water table.
	float table = uTable + w * 0.06;
	float sat = smoothstep(table + 0.015, table - 0.015, vWPos.y) * step(0.14, d);
	col = mix(col, col * vec3(0.55, 0.72, 0.95) + vec3(0.0, 0.025, 0.06), sat * 0.85);
	float edge = smoothstep(0.02, 0.0, abs(vWPos.y - table)) * step(0.14, d);
	col = mix(col, vec3(0.25, 0.55, 0.8), edge * 0.6);
	diffuseColor.rgb = col;
}`);
	};
	const mesh = new THREE.Mesh(geom, mat);
	mesh.receiveShadow = true;
	return { mesh, uniforms };
}

// Instanced pines, broadleaf trees and boulders.
export function createVegetation(THREE, land, terrain, quality) {
	const high = quality === "high";
	const counts = high ? { pine: 2600, broad: 700, rock: 160 } : { pine: 900, broad: 260, rock: 70 };
	let seed = 7;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	// Stepped lathe profile reads as a low-poly tiered pine.
	const pineProfile = [ [ 0, 1 ], [ 0.2, 0.68 ], [ 0.1, 0.7 ], [ 0.29, 0.38 ], [ 0.15, 0.4 ], [ 0.36, 0.08 ], [ 0, 0.08 ] ].map(([ r, y ]) => new THREE.Vector2(r, y));
	const pineGeom = new THREE.LatheGeometry(pineProfile.reverse(), 7);
	const trunkGeom = new THREE.CylinderGeometry(0.035, 0.05, 0.12, 5);
	trunkGeom.translate(0, 0.06, 0);
	const broadGeom = new THREE.IcosahedronGeometry(0.5, 1);
	{
		const p = broadGeom.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const k = 0.85 + 0.3 * fbm(p.getX(i) * 3 + 5, p.getY(i) * 3 + p.getZ(i) * 2, 2);
			p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9 + 0.62, p.getZ(i) * k);
		}
		broadGeom.computeVertexNormals();
	}
	const rockGeom = new THREE.DodecahedronGeometry(0.5, 0);

	const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
	const broadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
	const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.9 });
	const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, flatShading: true });

	const make = (geom, mat, n) => {
		const m = new THREE.InstancedMesh(geom, mat, n);
		m.castShadow = high;
		m.receiveShadow = true;
		return m;
	};
	const pines = make(pineGeom, pineMat, counts.pine);
	const pineTrunks = make(trunkGeom, trunkMat, counts.pine);
	const broads = make(broadGeom, broadMat, counts.broad);
	const broadTrunks = make(trunkGeom, trunkMat, counts.broad);
	const rocks = make(rockGeom, rockMat, counts.rock);

	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();
	const s = new THREE.Vector3();
	const v = new THREE.Vector3();
	const col = new THREE.Color();
	const clear = (x, z, pad) => {
		if (Math.abs(x) > BOX.w / 2 - 0.08 || Math.abs(z) > FRONT - 0.08) return false;
		for (const L of land.lakes) if (lakeD(L, x, z) < 1.12 + pad) return false;
		const nr = land.nearRiver(x, z, 0.14);
		return !nr || nr.d > 0.09;
	};
	const place = (mesh, trunk, n, accept, size, colorFn) => {
		let k = 0;
		for (let tries = 0; k < n && tries < n * 60; tries++) {
			const x = (rnd() - 0.5) * BOX.w;
			const z = (rnd() - 0.5) * BOX.d;
			const y = terrain.sample(x, z);
			const ny = terrain.normalAt(x, z);
			if (!accept(x, y, z, ny)) continue;
			const sc = size(y);
			e.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
			q.setFromEuler(e);
			s.set(sc * (0.9 + rnd() * 0.2), sc * (0.9 + rnd() * 0.35), sc * (0.9 + rnd() * 0.2));
			m4.compose(v.set(x, y - 0.01, z), q, s);
			mesh.setMatrixAt(k, m4);
			mesh.setColorAt(k, colorFn(col, y, rnd()));
			if (trunk) trunk.setMatrixAt(k, m4);
			k++;
		}
		mesh.count = k;
		if (trunk) trunk.count = k;
		mesh.instanceMatrix.needsUpdate = true;
	};
	const shastaCone = (x, z) => Math.hypot(x - MT_SHASTA[0], z - MT_SHASTA[1]) < 0.75;
	// Pines on the mountain slopes, thinning out toward the tree line.
	place(pines, pineTrunks, counts.pine, (x, y, z, ny) => {
		if (y < 0.45 || y > 2.35 + fbm(x, z, 2) * 0.4 || ny < 0.7 || shastaCone(x, z) || !clear(x, z, 0.05)) return false;
		const dens = fbm(x * 1.6 + 2, z * 1.6, 3);
		return dens > 0.42 && rnd() < smooth(2.5, 1.6, y) + 0.15;
	}, (y) => 0.2 + rnd() * 0.12 - y * 0.02, (c, y, r) => c.setHSL(0.3 + r * 0.05, 0.38 + r * 0.12, 0.17 + r * 0.06 + (y > 1.8 ? 0.02 : 0)));
	// Broadleaf oaks and cottonwoods in the foothills and along the valley rivers.
	place(broads, broadTrunks, counts.broad, (x, y, z, ny) => {
		if (y > 0.9 || ny < 0.82 || !clear(x, z, 0.12)) return false;
		const nr = land.nearRiver(x, z, 0.4);
		const riparian = nr ? smooth(0.4, 0.12, nr.d) : 0;
		return rnd() < 0.18 + riparian * 0.7 && fbm(x * 2 + 9, z * 2, 2) > 0.38;
	}, () => 0.14 + rnd() * 0.08, (c, y, r) => c.setHSL(0.2 + r * 0.08, 0.42 + r * 0.15, 0.25 + r * 0.08));
	// Boulders on steep and high ground.
	place(rocks, null, counts.rock, (x, y, z, ny) => {
		if (!clear(x, z, 0.05)) return false;
		return (ny < 0.82 && y > 0.6 && y < 2.1) || rnd() < 0.03;
	}, () => 0.06 + rnd() * 0.12, (c, y, r) => c.setHSL(0.08, 0.06, 0.24 + r * 0.1));
	[ pines, broads, rocks ].forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });

	const group = new THREE.Group();
	group.add(pines, pineTrunks, broads, broadTrunks, rocks);
	return { group, count: () => pines.count + broads.count + rocks.count };
}
