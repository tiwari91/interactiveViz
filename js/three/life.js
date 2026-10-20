// Life round each dam, for close views: a small marina at the current shoreline with boats in its
// slips, a concrete boat ramp, boats out on the lake with their wakes, anglers at the water's
// edge, a transmission line leaving the powerhouse, waterbirds, circling vultures, deer at the
// forest edge and cattle on foothill grass.
//
// Everything is modelled in metres and drawn close to true size: the terrain is about a kilometre
// per world unit, so a boat is a pixel or two even at the closest zoom. Nothing is inflated to
// read; instead each model is drawn only while it is at least about 3 px on screen, and the
// exaggeration of any model is capped at CAP_MAX. Everything is instanced and low-poly, and the
// whole layer is skipped beyond a close view, so the state overview never draws it.
import { EXAGGERATION } from "./world.js";
import { regionOf, pelicanLake } from "./regions.js";

// Drawn size over true size, per kind. People and animals may be drawn a little larger; boats and
// structures are near true size.
export const CAP = { person: 4, bird: 4, beast: 4, boat: 2, houseboat: 1.5, dock: 1.5, ramp: 1.2, tower: 1, wake: 1 };
export const CAP_MAX = 4;
// On-screen size (CSS px, the model's largest extent) below which a model is not drawn.
export const MIN_PX = [ 2.5, 3.5 ];
const FADE_NEAR = 45;
const FADE_FAR = 85;
// Beyond this distance from every dam (and this height over the ground) nothing is drawn.
const SHOW_WITHIN = 110;
const SHOW_HEIGHT = 90;
// Steepest true grade (rise over run, before the relief exaggeration) anything may stand on.
export const GENTLE = 0.2;
// Water at least this deep (land-local units, ~6 m) under every boat, dock and waterbird.
const MARGIN = 0.04;
// The lake surface fades in over its first ~0.3 units of depth (water.js), so the shore a viewer
// sees is about this deep: the marina and boats keep to water at least this deep.
const SEEN = 0.13;
// The concrete ramp's true length (m); beyond it a dirt track runs on down the bed.
export const RAMP_LEN = 220;
// Longest gangway (m) from the water's edge out to the floating marina.
export const GANGWAY_MAX = 700;
// Lakes big enough for a houseboat fleet: Shasta, Oroville, Trinity (Clair Engle).
const HOUSEBOAT_LAKES = new Set([ "SHA", "ORO", "CLE" ]);
const WHITE = 0xffffff;

function rng(seed) {
	let s = Math.abs(Math.floor(seed)) % 2147483646 + 1;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Box-built models in metres (forward +x, up +y, ground or waterline at y = 0), merged into one
// flat-shaded, vertex-coloured geometry and scaled to world units. Pure white parts take each
// instance's colour (a shirt, a hull); everything else keeps its own colour.
function model(THREE) {
	const parts = [];
	const api = {
		box(w, h, d, x, y, z, color, { rx = 0, ry = 0, rz = 0, shape = null } = {}) {
			const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
			if (shape) {
				const p = g.attributes.position;
				for (let i = 0; i < p.count; i++) {
					const v = shape(p.getX(i), p.getY(i), p.getZ(i), w, h, d);
					p.setXYZ(i, v[0], v[1], v[2]);
				}
			}
			g.rotateX(rx);
			g.rotateZ(rz);
			g.rotateY(ry);
			g.translate(x, y, z);
			parts.push({ g, color });
			return api;
		},
		// Flat triangles (x, z pairs in metres) at height y, for wakes.
		tris(pts, y, color) {
			const g = new THREE.BufferGeometry();
			g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap(([ x, z ]) => [ x, y, z ]), 3));
			parts.push({ g, color });
			return api;
		},
		build(scale) {
			const pos = [];
			const col = [];
			const c = new THREE.Color();
			for (const { g, color } of parts) {
				c.set(color);
				const p = g.attributes.position;
				for (let i = 0; i < p.count; i++) {
					pos.push(p.getX(i) * scale, p.getY(i) * scale, p.getZ(i) * scale);
					col.push(c.r, c.g, c.b);
				}
			}
			const out = new THREE.BufferGeometry();
			out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
			out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
			out.computeVertexNormals();
			out.computeBoundingBox();
			// True size (m) of the model, for the cap check.
			const bb = out.boundingBox;
			out.userData.metres = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / scale;
			return out;
		},
	};
	return api;
}

const M = (THREE) => model(THREE);

function personGeom(THREE, k) {
	return M(THREE)
		.box(0.26, 0.85, 0.32, 0, 0.425, 0, 0x2f3542)
		.box(0.3, 0.62, 0.46, 0, 1.16, 0, WHITE)
		.box(0.22, 0.24, 0.22, 0, 1.6, 0, 0xc99a74)
		// A rod held out over the water.
		.box(2.8, 0.05, 0.05, 1.25, 1.75, 0.15, 0x26221e, { rz: 0.45 })
		.build(k * CAP.person);
}

// Narrow the bow (+x end) of a hull to a point and lift its keel.
const bow = (x, y, z, w) => {
	const t = Math.max(0, x / (w / 2));
	return [ x, y + (y < 0 ? t * 0.3 : 0), z * (1 - 0.8 * t * t) ];
};

// A 6 m runabout: a pointed hull in the instance colour, a light deck, a dark stripe and a console.
function boatGeom(THREE, k) {
	return M(THREE)
		.box(6, 0.8, 2.3, 0, 0.15, 0, WHITE, { shape: bow })
		.box(5.6, 0.12, 2.32, -0.1, 0.38, 0, 0x2c3540, { shape: bow })
		.box(4.6, 0.06, 1.9, -0.4, 0.58, 0, 0xd8d2c4)
		.box(0.8, 0.6, 1.1, -0.3, 0.9, 0, 0x30353c)
		.build(k * CAP.boat);
}

// An 18 m houseboat: twin pontoons under a long boxy cabin with a flat roof deck.
function houseboatGeom(THREE, k) {
	const m = M(THREE);
	for (const z of [ -1.7, 1.7 ]) m.box(18, 0.9, 1.1, 0, 0.1, z, 0x9aa0a6, { shape: bow });
	return m
		.box(16, 0.25, 4.6, -0.3, 0.6, 0, 0xcfc9bc)
		.box(12.5, 2.4, 4.2, -1.2, 1.9, 0, WHITE)
		.box(13, 0.18, 4.6, -1.2, 3.2, 0, 0x6b6f75)
		.box(0.2, 1.0, 3.8, 5.1, 1.3, 0, 0x3a3f46)
		.build(k * CAP.houseboat);
}

// Marina layout in metres: a main walkway along local z (the shore), finger slips reaching out
// into the lake (+x). Weathered grey composite, low on the water; the inner run of slips is
// covered by a pale metal roof, as at most California lake marinas (it is what reads from afar).
const DOCK = { len: 96, walk: 3, finger: 12, step: 8, wood: 0x6b665e, roof: 0xc4c6c4, covered: 40 };
const SLIPS = (() => {
	const out = [];
	for (let z = -DOCK.len / 2 + DOCK.step / 2; z < DOCK.len / 2; z += DOCK.step) out.push(z);
	return out;
})();
function dockGeom(THREE, k) {
	const m = M(THREE).box(DOCK.walk, 0.4, DOCK.len, 0, 0.12, 0, DOCK.wood);
	for (let z = -DOCK.len / 2; z <= DOCK.len / 2 + 0.01; z += DOCK.step) m.box(DOCK.finger, 0.35, 1.2, DOCK.walk / 2 + DOCK.finger / 2, 0.1, z, 0x726c63);
	// Covered slips: posts and a shallow-pitched roof over the walkway end of the run.
	const x0 = DOCK.walk / 2 + DOCK.finger / 2;
	const zc = -DOCK.len / 2 + DOCK.covered / 2;
	for (const z of [ zc - DOCK.covered / 2, zc + DOCK.covered / 2 ]) for (const x of [ x0 - 5, x0 + 5 ]) m.box(0.3, 4, 0.3, x, 2.2, z, 0x55585a);
	m.box(DOCK.finger + 2, 0.3, DOCK.covered + 1, x0, 4.4, zc, DOCK.roof, { shape: (x, y, z) => [ x, y + (0.5 - Math.abs(x) / (DOCK.finger + 2)) * 1.2, z ] });
	return m.build(k * CAP.dock);
}
// A 1 m length of floating gangway, stretched along x to reach the shore.
function gangwayGeom(THREE, k) {
	const g = M(THREE).box(1, 0.3, 2, 0.5, 0.1, 0, 0x5f5a52).build(k * CAP.dock);
	g.userData.metres = 60;
	return g;
}

// A boat's wake: two arms of foam spreading back from the stern, and churned water behind it.
function wakeGeom(THREE, k) {
	const tri = (a, b, c) => [ a, b, c ];
	const pts = [];
	for (const s of [ 1, -1 ]) {
		pts.push(...tri([ -2, 1.2 * s ], [ -80, 22 * s ], [ -80, 15 * s ]), ...tri([ -2, 1.2 * s ], [ -80, 15 * s ], [ -2, 0.3 * s ]));
	}
	pts.push(...tri([ -2, 1.2 ], [ -45, 4 ], [ -45, -4 ]), ...tri([ -2, 1.2 ], [ -45, -4 ], [ -2, -1.2 ]));
	return M(THREE).tris(pts, 0.15, 0xf4f6f6).build(k * CAP.wake);
}

// A 40 m lattice pylon read as four splayed legs, cross-arms and a peak.
function towerGeom(THREE, k) {
	const H = 38;
	const m = M(THREE);
	for (const [ sx, sz ] of [ [ 1, 1 ], [ 1, -1 ], [ -1, 1 ], [ -1, -1 ] ]) {
		m.box(0.6, H, 0.6, 0, H / 2, 0, 0x8b9298, { shape: (x, y, z) => {
			const t = (y + H / 2) / H;
			const spread = 3.4 * (1 - t) + 0.9 * t;
			return [ x + sx * spread, y, z + sz * spread ];
		} });
	}
	for (const y of [ 10, 20, 29 ]) m.box(4.6 - y * 0.08, 0.35, 4.6 - y * 0.08, 0, y, 0, 0x8b9298);
	m.box(0.8, 0.7, 17, 0, 31, 0, 0x8b9298).box(0.8, 0.7, 12, 0, 36, 0, 0x8b9298).box(0.5, 5, 0.5, 0, H + 2, 0, 0x8b9298);
	return m.build(k * CAP.tower);
}
const TOWER_ARMS = [ [ 31, 8.2 ], [ 31, -8.2 ], [ 36, 5.8 ], [ 36, -5.8 ] ];
// Pylons along a line (m apart), and how many there may be.
const TOWER_STEP = 360;
const TOWER_MAX = 14;

function gooseGeom(THREE, k) {
	return M(THREE)
		.box(0.85, 0.32, 0.42, 0, 0.1, 0, 0x6f665b)
		.box(0.09, 0.42, 0.09, 0.38, 0.42, 0, 0x1d1c1b)
		.box(0.2, 0.1, 0.09, 0.45, 0.64, 0, 0x1d1c1b)
		.build(k * CAP.bird);
}

function duckGeom(THREE, k) {
	return M(THREE)
		.box(0.55, 0.24, 0.3, 0, 0.08, 0, 0x8c857a)
		.box(0.16, 0.16, 0.14, 0.24, 0.27, 0, 0x2e5b3c)
		.build(k * CAP.bird);
}

function pelicanGeom(THREE, k) {
	return M(THREE)
		.box(1.4, 0.5, 0.62, 0, 0.18, 0, 0xf1efe9)
		.box(0.45, 0.14, 0.64, -0.5, 0.36, 0, 0x26231f)
		.box(0.13, 0.5, 0.13, 0.6, 0.55, 0, 0xf1efe9)
		.box(0.5, 0.09, 0.1, 0.86, 0.76, 0, 0xe0993a, { rz: -0.25 })
		.build(k * CAP.bird);
}

// A soaring turkey vulture or hawk: body and shallow-V wings spanning z.
function raptorGeom(THREE, k) {
	return M(THREE)
		.box(0.7, 0.18, 0.24, 0, 0, 0, 0x2b2622)
		.box(0.5, 0.05, 0.9, -0.02, 0.06, 0.55, 0x2b2622, { rx: -0.2 })
		.box(0.5, 0.05, 0.9, -0.02, 0.06, -0.55, 0x2b2622, { rx: 0.2 })
		.box(0.12, 0.1, 0.1, 0.4, 0.02, 0, 0xa8483b)
		.build(k * CAP.bird);
}

// Quadrupeds; the head and neck (x beyond the pivot) dip when grazing.
function deerGeom(THREE, k) {
	const m = M(THREE).box(1.3, 0.55, 0.45, 0, 1.0, 0, 0x8a6a4a);
	for (const [ x, z ] of [ [ 0.5, 0.15 ], [ 0.5, -0.15 ], [ -0.5, 0.15 ], [ -0.5, -0.15 ] ]) m.box(0.1, 0.8, 0.1, x, 0.4, z, 0x6a5038);
	m.box(0.18, 0.55, 0.18, 0.72, 1.4, 0, 0x8a6a4a, { rz: -0.35 }).box(0.34, 0.18, 0.16, 0.95, 1.65, 0, 0x7d5f42).box(0.12, 0.14, 0.12, -0.68, 1.12, 0, 0xe8e0d0);
	return m.build(k * CAP.beast);
}
const DEER_PIVOT = [ 0.6, 1.15 ];

function cowGeom(THREE, k) {
	const m = M(THREE).box(2.0, 0.95, 0.8, 0, 1.05, 0, WHITE);
	for (const [ x, z ] of [ [ 0.75, 0.25 ], [ 0.75, -0.25 ], [ -0.75, 0.25 ], [ -0.75, -0.25 ] ]) m.box(0.18, 0.62, 0.18, x, 0.31, z, 0x2a2420);
	m.box(0.45, 0.42, 0.36, 1.2, 1.2, 0, WHITE).box(0.2, 0.3, 0.3, 1.43, 1.12, 0, 0xe2dcd0);
	return m.build(k * CAP.beast);
}
const COW_PIVOT = [ 0.95, 1.25 ];

export function createLife(THREE, { basins, dams, outflow, router, world, riparian, shared, quality }) {
	const group = new THREE.Group();
	group.name = "life";
	const infra = new THREE.Group();
	const wild = new THREE.Group();
	group.add(infra, wild);
	const unsquash = { value: 1 };
	// World units per CSS pixel at unit distance, from the camera and the canvas height.
	const pxScale = { value: 1 };
	const stats = { sites: 0, anglers: 0, boats: 0, houseboats: 0, docks: 0, ramps: 0, towers: 0, lines: 0, waterbirds: 0, raptors: 0, deer: 0, cattle: 0, maxGrade: 0 };
	const off = {
		group, infra, wild, stats, setUnsquash() {}, update() {}, setLevels() {},
		debug: () => ({ stats, visible: false, water: [] }),
	};
	if (quality !== "high") return off;

	// World units per metre (horizontal).
	const K = world.vscale / EXAGGERATION;
	const S = (x, z) => router.surface(x, z);
	const grade = (x, z, d = 0.25) => Math.hypot(S(x + d, z) - S(x - d, z), S(x, z + d) - S(x, z - d)) / (2 * d) / EXAGGERATION;
	// Gentle at the point and over a small footprint round it.
	const gentle = (x, z, r = 0.3, limit = GENTLE) => {
		let g = grade(x, z);
		for (const [ a, b ] of [ [ r, 0 ], [ -r, 0 ], [ 0, r ], [ 0, -r ] ]) g = Math.max(g, grade(x + a, z + b));
		return g <= limit ? g : -1;
	};

	// River ribbons, on a coarse grid for quick "near the water" tests.
	const CELL = 2;
	const riverGrid = new Map();
	for (const p of outflow.bankPoints(0.5)) {
		const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
		if (!riverGrid.has(k)) riverGrid.set(k, []);
		riverGrid.get(k).push(p);
	}
	const onRiver = (x, z, pad) => {
		const cx = Math.floor(x / CELL);
		const cz = Math.floor(z / CELL);
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				for (const p of riverGrid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < p.half * 1.05 + pad) return true;
			}
		}
		return false;
	};
	const damList = basins.basins.map((b) => ({ b, d: dams.info.get(b.r.id) }));
	const onDam = (x, z, pad) => damList.some(({ b, d }) => {
		if (Math.abs(x - b.cx) > b.reach || Math.abs(z - b.cz) > b.reach) return false;
		const [ u, v ] = b.toLocal(x, z);
		if (Math.abs(v) < d.halfWidth * 1.12 + pad && u > d.toeU - pad - 0.3 && u < b.dam.u + 1.2 + pad) return true;
		const [ px, , pz, w, , dd ] = d.powerhouse;
		return Math.hypot(x - px, z - pz) < Math.max(w, dd) * 0.8 + pad;
	});
	const taken = [];
	// Open, dry, gentle ground off the dam, chute and rivers, clear of anything placed already.
	const clearAt = (x, z, r = 0.15, limit = GENTLE) => {
		const sfc = basins.surfaceAt(x, z);
		if (sfc && (sfc.zone === "bowl" || sfc.zone === "shore")) return -1;
		if (onDam(x, z, r) || outflow.nearChute(x, z, 0.6 + r) || onRiver(x, z, r + 0.08)) return -1;
		for (const t of taken) if (Math.hypot(t[0] - x, t[1] - z) < t[2] + r) return -1;
		return gentle(x, z, Math.max(0.2, r), limit);
	};
	const claim = (x, z, r, g) => {
		taken.push([ x, z, r ]);
		stats.maxGrade = Math.max(stats.maxGrade, g);
	};

	// Shaders: detail models keep their shape whatever the relief scale (view3d squashes the land
	// group vertically), are drawn only while big enough on screen (and near enough), tint only
	// their white parts per instance, and animate off the shared clock (still under reduced motion).
	const SCREEN = (size) => `(${size.toFixed(5)} * uPxScale / max(1e-4, distance(base, cameraPosition)))`;
	const VIS = (size) => `smoothstep(${MIN_PX[0].toFixed(1)}, ${MIN_PX[1].toFixed(1)}, ${SCREEN(size)}) * (1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, distance(base, cameraPosition)))`;
	const material = (size, anim = "", { basic = false, fade = false, opacity = 1 } = {}) => {
		const mat = basic
			? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false })
			: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true, transparent: fade });
		mat.onBeforeCompile = (sh) => {
			sh.uniforms.uUnsquash = unsquash;
			sh.uniforms.uTime = shared.uTime;
			sh.uniforms.uPxScale = pxScale;
			sh.vertexShader = sh.vertexShader
				.replace("#include <common>", `#include <common>\nuniform float uUnsquash;\nuniform float uTime;\nuniform float uPxScale;\nattribute float aPhase;\n${fade ? "attribute float aFade;\nvarying float vFade;" : ""}`)
				.replace("#include <color_vertex>", `vColor = vec3(1.0);
	#ifdef USE_COLOR
	vColor = color.rgb;
	#endif
	#ifdef USE_INSTANCING_COLOR
	if (min(color.r, min(color.g, color.b)) > 0.99) vColor *= instanceColor.rgb;
	#endif`)
				.replace("#include <begin_vertex>", `#include <begin_vertex>
	${anim}
	transformed.y *= uUnsquash;
	{
		vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
		transformed *= ${VIS(size)};
		${fade ? "vFade = aFade;" : ""}
	}`);
			if (fade) {
				sh.fragmentShader = sh.fragmentShader
					.replace("#include <common>", "#include <common>\nvarying float vFade;")
					.replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.a *= vFade;");
			}
		};
		// Each set's shader differs (its size, animation, fade): never share a cached program.
		const key = `life:${size}:${anim}:${basic}:${fade}`;
		mat.customProgramCacheKey = () => key;
		return mat;
	};
	const f = (v) => v.toFixed(5);
	const ANIM = {
		// Wings beat in bursts between long glides.
		flap: `{ float beat = sin(uTime * 7.0 + aPhase * 6.2832) * step(0.55, sin(uTime * 0.45 + aPhase * 17.0)); transformed.y += abs(transformed.z) * beat * 0.7; }`,
		// Slow drift on the water (a few metres).
		drift: `{ float r = ${f(4 * K)}; transformed.x += sin(uTime * 0.21 + aPhase * 6.2832) * r; transformed.z += cos(uTime * 0.16 + aPhase * 9.1) * r; }`,
		graze: (p, k) => `{ float g = smoothstep(-0.3, 0.5, sin(uTime * 0.35 + aPhase * 6.2832)); float d = max(0.0, transformed.x - ${f(p[0] * k)}); transformed.y -= g * d * 1.5; transformed.x -= g * d * 0.35; }`,
	};

	const sets = [];
	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const q2 = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const v3 = new THREE.Vector3();
	const s3 = new THREE.Vector3();
	const col = new THREE.Color();
	const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
	function instanced(name, geom, cap, parent, anim = "", opts = {}) {
		const phase = new Float32Array(cap);
		const r = rng(cap * 31 + name.length * 7);
		for (let i = 0; i < cap; i++) phase[i] = r();
		geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
		let fadeAttr = null;
		if (opts.fade) {
			fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
			geom.setAttribute("aFade", fadeAttr);
		}
		const bb = geom.boundingBox;
		// The model's largest extent in world units: what the on-screen size test measures.
		const size = opts.size ?? Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
		const mesh = new THREE.InstancedMesh(geom, material(size, anim, opts), cap);
		mesh.name = `life-${name}`;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = !opts.basic;
		mesh.count = 0;
		mesh.setColorAt(0, col.set(WHITE));
		if (opts.basic) mesh.renderOrder = 2;
		parent.add(mesh);
		const set = {
			name, mesh, cap, n: 0, where: [], size, metres: geom.userData.metres, fadeAttr,
			// Drawn size over true size.
			exaggeration: size / K / geom.userData.metres,
			add(x, y, z, ang, color = WHITE, sc = 1) {
				if (this.n >= cap) return -1;
				const i = this.n++;
				this.put(i, x, y, z, ang, sc);
				mesh.setColorAt(i, col.set(color));
				mesh.count = this.n;
				return i;
			},
			put(i, x, y, z, ang, sc = 1, roll = 0, sx = sc) {
				q.setFromAxisAngle(up, ang);
				if (roll) q.multiply(q2.setFromAxisAngle(v3.set(1, 0, 0), roll));
				m4.compose(v3.set(x, y, z), q, s3.set(sx, sc, sc));
				mesh.setMatrixAt(i, m4);
				this.where[i] = [ x, y, z ];
			},
			hide(i) {
				mesh.setMatrixAt(i, ZERO);
				this.where[i] = null;
			},
		};
		sets.push(set);
		return set;
	}
	// Facing (dx, dz): rotation about y that turns the model's +x that way.
	const face = (dx, dz) => Math.atan2(-dz, dx);

	const anglers = instanced("anglers", personGeom(THREE, K), 500, infra);
	const boats = instanced("boats", boatGeom(THREE, K), 600, infra);
	const houseboats = instanced("houseboats", houseboatGeom(THREE, K), 60, infra);
	const docks = instanced("docks", dockGeom(THREE, K), 60, infra);
	const gangways = instanced("gangways", gangwayGeom(THREE, K), 60, infra, "", { size: 40 * K });
	const wakes = instanced("wakes", wakeGeom(THREE, K), 300, infra, "", { basic: true, opacity: 0.55 });
	const towers = instanced("towers", towerGeom(THREE, K), 600, infra, "", { fade: true });
	const geese = instanced("geese", gooseGeom(THREE, K), 1600, wild, ANIM.drift);
	const ducks = instanced("ducks", duckGeom(THREE, K), 1600, wild, ANIM.drift);
	const pelicans = instanced("pelicans", pelicanGeom(THREE, K), 700, wild, ANIM.drift);
	const raptors = instanced("raptors", raptorGeom(THREE, K), 160, wild, ANIM.flap);
	const deer = instanced("deer", deerGeom(THREE, K), 400, wild, ANIM.graze(DEER_PIVOT, K * CAP.beast));
	const cattle = instanced("cattle", cowGeom(THREE, K), 900, wild, ANIM.graze(COW_PIVOT, K * CAP.beast));

	const SHIRTS = [ 0xc8442f, 0x2f6fb0, 0xe0b33a, 0xf0ede6, 0x3c7f4e, 0x7a4a8c, 0xe07b39, 0x29a0a8 ];
	const HULLS = [ 0xf2f0ea, 0xf2f0ea, 0xf2f0ea, 0xe4e1d8, 0xb9c3cc, 0x8f2a24, 0x2c4f7a ];
	const COWS = [ 0x1f1b18, 0x1f1b18, 0x5a3424, 0x7a4630, 0x2b2420 ];

	// Draped ground pieces (the ramps and the tracks below them) in one static mesh.
	const flat = { pos: [], col: [] };
	const drapeQuad = (a, b, c, d, color, lift = 0.03) => {
		col.set(color);
		for (const p of [ a, b, c, a, c, d ]) {
			flat.pos.push(p[0], p[1] + lift, p[2]);
			flat.col.push(col.r, col.g, col.b);
		}
	};
	// A strip along a polyline of [x, y, z] points, `half` wide each side.
	const strip = (pts, half, color, lift) => {
		for (let i = 0; i < pts.length - 1; i++) {
			const [ ax, ay, az ] = pts[i];
			const [ bx, by, bz ] = pts[i + 1];
			const l = Math.hypot(bx - ax, bz - az) || 1;
			const nx = -(bz - az) / l * half;
			const nz = (bx - ax) / l * half;
			drapeQuad([ ax + nx, ay, az + nz ], [ bx + nx, by, bz + nz ], [ bx - nx, by, bz - nz ], [ ax - nx, ay, az - nz ], color, lift);
		}
	};

	// Wires between towers: each vertex is ground height (scaled with the land) plus a lift in
	// true units, so the spans keep their sag whatever the relief scale; they fade with the towers.
	const wire = { pos: [], lift: [], fade: [] };
	const span = (a, b, fa, fb) => {
		const N = 10;
		const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
		for (let k = 0; k < N; k++) {
			for (const t of [ k / N, (k + 1) / N ]) {
				const sag = 4 * t * (1 - t) * len * 0.03;
				wire.pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
				wire.lift.push(a[3] + (b[3] - a[3]) * t - sag);
				wire.fade.push(fa + (fb - fa) * t);
			}
		}
	};

	const bedAt = (x, z, id) => {
		const sfc = basins.surfaceAt(x, z);
		return sfc && sfc.zone === "bowl" && sfc.basinId === id ? sfc.h : Infinity;
	};
	// Where riparian crowns overlap a ramp, the trees go.
	const clearTrees = [];

	const sites = [];
	const r = rng(4242);
	const pick = (arr) => arr[Math.floor(r() * arr.length)];

	for (const { b, d } of damList) {
		const region = regionOf(b.r);
		const site = { b, d, region, center: d.center, soar: [], water: null, lastLevel: null, lastVis: null, river: 0 };
		sites.push(site);
		stats.sites++;
		const down = [ -b.eu[0], -b.eu[1] ];
		const scale = d.scale;
		const id = b.r.id;

		// Transmission line: pylons every few hundred metres from the powerhouse up and out of the
		// canyon, each on the nearest gentle spot to its stake. The last few fade out, so the line
		// runs on past the detail rather than stopping; too short a line is not drawn at all.
		{
			const [ px, py, pz, , ph ] = d.powerhouse;
			const side = b.toLocal(px, pz)[1] >= 0 ? 1 : -1;
			const dir = [ b.ev[0] * side * 0.85 + down[0] * 0.5, b.ev[1] * side * 0.85 + down[1] * 0.5 ];
			const dl = Math.hypot(...dir);
			dir[0] /= dl;
			dir[1] /= dl;
			const towerAng = face(dir[0], dir[1]) + Math.PI / 2;
			const line = [];
			let prev = [ px, pz ];
			for (let k = 1; k <= TOWER_MAX; k++) {
				const step = TOWER_STEP * K * k + 0.6;
				let spot = null;
				for (let tries = 0; tries < 14 && !spot; tries++) {
					const x = px + dir[0] * step + (r() - 0.5) * 120 * K;
					const z = pz + dir[1] * step + (r() - 0.5) * 120 * K;
					const g = clearAt(x, z, 20 * K);
					if (g >= 0) spot = [ x, z, g ];
				}
				// A gap (lake, river, steep ground) would mean a span too long: the line ends there.
				if (!spot || Math.hypot(spot[0] - prev[0], spot[1] - prev[1]) > TOWER_STEP * K * 2.2 + 0.6) break;
				line.push(spot);
				prev = spot;
			}
			if (line.length >= 5) {
				stats.lines++;
				const n = line.length;
				// Fully drawn near the dam, fading over the last four towers.
				const fadeOf = (k) => Math.min(1, (n - k) / 4.5);
				const ca = Math.cos(towerAng);
				const sa = Math.sin(towerAng);
				let prevArms = null;
				line.forEach(([ x, z, g ], k) => {
					claim(x, z, 20 * K, g);
					const y = S(x, z) - 0.002;
					const i = towers.add(x, y, z, towerAng);
					if (i < 0) return;
					towers.fadeAttr.setX(i, fadeOf(k));
					stats.towers++;
					// Cross-arm tips: the model's z axis turned by the tower's heading.
					const arms = TOWER_ARMS.map(([ ay, az ]) => [ x + sa * az * K, y, z + ca * az * K, ay * K ]);
					if (prevArms) arms.forEach((a, m) => span(prevArms[m], a, fadeOf(k - 1), fadeOf(k)));
					else arms.forEach((a) => span([ px, py, pz, ph ], a, 1, 1));
					prevArms = arms;
				});
			}
		}

		// Anglers on the banks just below the dam, at the water's edge, facing the river.
		{
			const near = [];
			for (const cell of riverGrid.values()) {
				for (const p of cell) {
					const dd = Math.hypot(p.x - d.toePoint[0], p.z - d.toePoint[2]);
					if (p.kind === 0 && dd > 1.2 && dd < 7) near.push(p);
				}
			}
			const want = 2 + Math.floor(r() * 3);
			for (let tries = 0; tries < 40 && site.river !== want && near.length; tries++) {
				const p = pick(near);
				const sd = r() < 0.5 ? -1 : 1;
				const o = p.half * 1.05 + 3 * K;
				const x = p.x + p.sx * o * sd;
				const z = p.z + p.sz * o * sd;
				const sfc = basins.surfaceAt(x, z);
				if (sfc && (sfc.zone === "bowl" || sfc.zone === "shore")) continue;
				if (onDam(x, z, 0.1) || outflow.nearChute(x, z, 0.7)) continue;
				if (taken.some((t) => Math.hypot(t[0] - x, t[1] - z) < t[2] + 5 * K)) continue;
				const g = gentle(x, z, 0.15);
				if (g < 0) continue;
				claim(x, z, 5 * K, g);
				anglers.add(x, S(x, z), z, face(-p.sx * sd, -p.sz * sd), pick(SHIRTS));
				site.river++;
				stats.anglers++;
			}
		}

		// Vultures circling over the canyon below the dam, a few hundred metres up.
		{
			const n = 1 + Math.floor(r() * 3);
			const cx = d.toePoint[0] + down[0] * (2 + scale);
			const cz = d.toePoint[2] + down[1] * (2 + scale);
			for (let k = 0; k < n; k++) {
				const i = raptors.add(cx, d.crest, cz, 0);
				if (i < 0) break;
				site.soar.push({ i, cx: cx + (r() - 0.5) * 0.8, cz: cz + (r() - 0.5) * 0.8, rad: (150 + r() * 250) * K, lift: (120 + r() * 250) * K, w: (0.18 + r() * 0.12) * (r() < 0.5 ? -1 : 1), ph: r() * 6.28, base: d.crest });
				stats.raptors++;
			}
		}

		// Boat ramp: on a gentle stretch of the full-pool shore, preferably in a cove (land on most
		// sides), running a fixed length down the bed; a dirt track carries on down to the lowest
		// water. The marina floats wherever the month's water is (placeWater).
		{
			let best = null;
			const wetAt = (x, z) => bedAt(x, z, id) < Infinity;
			for (let k = 0; k < 48; k++) {
				const th = (k / 48) * Math.PI * 2;
				const dir = [ Math.cos(th), Math.sin(th) ];
				// March out from the lake centre to the shore.
				let sx = null;
				let sz = null;
				for (let t = 0.5; t < b.Lu * 2.4; t += 0.05) {
					const x = b.cx + dir[0] * t;
					const z = b.cz + dir[1] * t;
					if (!wetAt(x, z)) {
						sx = x;
						sz = z;
						break;
					}
				}
				if (sx === null) continue;
				const [ u ] = b.toLocal(sx, sz);
				if (u < b.dam.u + 1.5 || Math.hypot(sx - d.center[0], sz - d.center[1]) < d.halfWidth + 1.5) continue;
				// The full-pool shore (inside the carved shore band): off the dam, chute and rivers, gentle.
				if (onDam(sx, sz, 0.3) || outflow.nearChute(sx, sz, 0.8) || onRiver(sx, sz, 0.15)) continue;
				if (taken.some((t) => Math.hypot(t[0] - sx, t[1] - sz) < t[2] + 0.1)) continue;
				const g = gentle(sx, sz, 0.1);
				if (g < 0) continue;
				// The bed below: samples every ~25 m into the lake, as long as it stays in the lake.
				const into = [ -dir[0], -dir[1] ];
				const bed = [];
				for (let t = 0; t < 6; t += 25 * K) {
					const x = sx + into[0] * t;
					const z = sz + into[1] * t;
					const h = bedAt(x, z, id);
					if (t > 0.1 && h === Infinity) break;
					bed.push([ x, h === Infinity ? S(x, z) : h, z ]);
				}
				if (bed.length < 6) continue;
				const lowest = Math.min(...bed.map((p) => p[1]));
				// Cove: the share of land on a ring round a point just offshore.
				const cx = sx + into[0] * 0.4;
				const cz = sz + into[1] * 0.4;
				let land = 0;
				for (let j = 0; j < 16; j++) if (!wetAt(cx + Math.cos(j * Math.PI / 8) * 1.1, cz + Math.sin(j * Math.PI / 8) * 1.1)) land++;
				const score = land / 16 * 2 - g * 4 - (bed[0][1] - lowest) * 0.2 - Math.hypot(sx - d.center[0], sz - d.center[1]) * 0.02;
				if (!best || score > best.score) best = { score, sx, sz, into, g, bed };
			}
			if (best) {
				const { sx, sz, into, g, bed } = best;
				claim(sx, sz, 0.1, g);
				stats.ramps++;
				// Concrete from just above the full-pool shore, RAMP_LEN down the bed; then a track.
				const head = [ sx - into[0] * 30 * K, sz - into[1] * 30 * K ];
				const cut = Math.max(2, Math.round((RAMP_LEN - 30) / 25) + 1);
				const concrete = [ [ head[0], S(head[0], head[1]), head[1] ], ...bed.slice(0, cut) ];
				strip(concrete, 6 * CAP.ramp * K, 0x9d988e, 0.01);
				const track = bed.slice(cut - 1);
				if (track.length > 1) strip(track, 3 * K, 0x8f7f66, 0.008);
				for (const p of concrete) clearTrees.push([ p[0], p[2] ]);
				const dockI = docks.add(sx, b.P, sz, 0);
				const gangI = gangways.add(sx, b.P, sz, 0);
				stats.docks++;
				// Boats in alternate slips (fewer when the lake is low), houseboats at the outer end
				// on the big northern lakes.
				const moor = [];
				const fleet = HOUSEBOAT_LAKES.has(id);
				SLIPS.forEach((z, k) => {
					const house = fleet && k >= SLIPS.length - 3;
					if (!house && r() < 0.35) return;
					const set = house ? houseboats : boats;
					const i = set.add(sx, b.P, sz, 0, house ? WHITE : pick(HULLS));
					if (i < 0) return;
					// Bow out, stern near the walkway; a houseboat runs past its shorter finger.
					const x = house ? DOCK.walk / 2 * CAP.dock + 9 * CAP.houseboat + 1 : (DOCK.walk / 2 + 6.5) * CAP.dock;
					moor.push({ set, i, x: x * K, z: z * CAP.dock * K, house, rank: r() });
					stats[house ? "houseboats" : "boats"]++;
				});
				const dockPeople = [];
				for (const z of [ -0.3, 0.35 ]) {
					const i = anglers.add(sx, b.P, sz, 0, pick(SHIRTS));
					if (i >= 0) dockPeople.push({ i, x: (DOCK.walk / 2 + DOCK.finger - 1) * CAP.dock * K, z: z * DOCK.len * CAP.dock * K });
				}
				site.ramp = { into, bed, concreteLen: (cut - 1) * 25 + 30, dockI, gangI, moor, dockPeople, state: null };
				stats.anglers += dockPeople.length;
			}
		}

		// Water slots for loose boats and rafts of waterbirds: points over the bowl, with the
		// highest bed within a small radius, so anything there is clear of the shore.
		{
			const slots = [];
			for (let k = 0; k < 260; k++) {
				const u = b.dam.u + 1 + r() * (b.Lu * 1.4 - b.dam.u - 1);
				const v = (r() * 2 - 1) * b.Lv * 1.3;
				const [ x, z ] = b.toWorld(u, v);
				let bedMax = -Infinity;
				let ok = true;
				for (const [ a, c ] of [ [ 0, 0 ], [ 0.3, 0 ], [ -0.3, 0 ], [ 0, 0.3 ], [ 0, -0.3 ], [ 0.21, 0.21 ], [ -0.21, 0.21 ], [ 0.21, -0.21 ], [ -0.21, -0.21 ] ]) {
					const h = bedAt(x + a, z + c, id);
					if (h === Infinity) {
						ok = false;
						break;
					}
					bedMax = Math.max(bedMax, h);
				}
				if (ok) slots.push({ x, z, bedMax, pref: r() });
			}
			slots.sort((a, c) => a.pref - c.pref);
			const loose = [];
			const nLoose = Math.min(8, 2 + Math.round(b.Lu / 3));
			for (let k = 0; k < nLoose; k++) {
				const house = HOUSEBOAT_LAKES.has(id) && k === 2;
				const set = house ? houseboats : boats;
				const i = set.add(b.cx, b.P, b.cz, r() * 6.28, house ? WHITE : pick(HULLS));
				if (i < 0) continue;
				// Most runabouts are under way, in slow loops a couple of hundred metres across.
				const moving = !house && k % 3 !== 2;
				const wake = moving ? wakes.add(b.cx, b.P, b.cz, 0) : -1;
				loose.push({ set, i, ang: r() * 6.28, moving, wake, rad: (90 + r() * 80) * K, w: (0.05 + r() * 0.04) * (r() < 0.5 ? -1 : 1), ph: r() * 6.28, rank: k });
				stats[house ? "houseboats" : "boats"]++;
			}
			const rafts = [];
			const nRafts = 2 + Math.floor(r() * 3);
			for (let k = 0; k < nRafts; k++) {
				const kind = pelicanLake(b.r) && k === 0 ? pelicans : r() < 0.5 ? geese : ducks;
				const birds = [];
				const n = kind === pelicans ? 6 + Math.floor(r() * 8) : 5 + Math.floor(r() * 9);
				for (let j = 0; j < n; j++) {
					const i = kind.add(b.cx, b.P, b.cz, r() * 6.28);
					if (i < 0) break;
					const a = r() * 6.28;
					const rr = Math.sqrt(r()) * 40 * K;
					birds.push({ i, dx: Math.cos(a) * rr, dz: Math.sin(a) * rr, ang: r() * 0.8 });
				}
				stats.waterbirds += birds.length;
				rafts.push({ set: kind, birds, heading: r() * 6.28 });
			}
			site.water = { slots, loose, rafts, live: [] };
		}

		// Deer at the forest edge (mountains), cattle grazing open foothill grass.
		if (region === "sierra" || region === "foothill") {
			const trees = riparian.trees().filter((t) => Math.hypot(t.x - b.cx, t.z - b.cz) < b.Lu * 1.6 + 10);
			const isDeer = region === "sierra";
			for (let h = 0; h < 3; h++) {
				let c = null;
				for (let tries = 0; tries < 50 && !c; tries++) {
					let x;
					let z;
					if (isDeer && trees.length) {
						const t = pick(trees);
						const a = r() * 6.28;
						x = t.x + Math.cos(a) * (0.8 + r() * 0.8);
						z = t.z + Math.sin(a) * (0.8 + r() * 0.8);
					} else {
						const a = r() * 6.28;
						const dd = b.Lu * (0.9 + r() * 0.8) + 2 + r() * 4;
						x = b.cx + Math.cos(a) * dd;
						z = b.cz + Math.sin(a) * dd;
					}
					if (clearAt(x, z, 0.15, isDeer ? GENTLE : 0.14) >= 0) c = [ x, z ];
				}
				if (!c) continue;
				const n = isDeer ? 2 + Math.floor(r() * 3) : 6 + Math.floor(r() * 9);
				const heading = r() * 6.28;
				for (let j = 0; j < n; j++) {
					const a = r() * 6.28;
					const rr = Math.sqrt(r()) * (isDeer ? 40 : 120) * K;
					const x = c[0] + Math.cos(a) * rr;
					const z = c[1] + Math.sin(a) * rr;
					const g = clearAt(x, z, 3 * K, isDeer ? GENTLE : 0.14);
					if (g < 0) continue;
					if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.3)) continue;
					claim(x, z, 3 * K, g);
					const set = isDeer ? deer : cattle;
					set.add(x, S(x, z), z, heading + (r() - 0.5) * 1.6, isDeer ? WHITE : pick(COWS));
					stats[isDeer ? "deer" : "cattle"]++;
				}
			}
		}
	}

	// No tree crown over a ramp.
	riparian.clearAround?.(clearTrees, 12 * K);

	// Ground pieces and wires.
	{
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(flat.pos, 3));
		g.setAttribute("color", new THREE.Float32BufferAttribute(flat.col, 3));
		g.computeVertexNormals();
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
		const mesh = new THREE.Mesh(g, mat);
		mesh.name = "life-ground";
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		infra.add(mesh);
	}
	{
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(wire.pos, 3));
		g.setAttribute("aLift", new THREE.Float32BufferAttribute(wire.lift, 1));
		g.setAttribute("aFade", new THREE.Float32BufferAttribute(wire.fade, 1));
		const mat = new THREE.LineBasicMaterial({ color: 0x2c2f33, transparent: true, opacity: 0.55 });
		// Drawn while the towers are (their on-screen size at this point), fading where they do.
		const base = "vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;";
		mat.onBeforeCompile = (sh) => {
			sh.uniforms.uUnsquash = unsquash;
			sh.uniforms.uPxScale = pxScale;
			sh.vertexShader = sh.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uUnsquash;\nuniform float uPxScale;\nattribute float aLift;\nattribute float aFade;\nvarying float vFade;")
				.replace("#include <begin_vertex>", "#include <begin_vertex>\n\ttransformed.y += aLift * uUnsquash;")
				.replace("#include <project_vertex>", `#include <project_vertex>\n\t{ ${base} vFade = aFade * ${VIS(towers.size)}; }`);
			sh.fragmentShader = sh.fragmentShader
				.replace("#include <common>", "#include <common>\nvarying float vFade;")
				.replace("#include <output_fragment>", "#include <output_fragment>\n\tgl_FragColor.a *= vFade;")
				.replace("#include <opaque_fragment>", "#include <opaque_fragment>\n\tgl_FragColor.a *= vFade;");
		};
		const lines = new THREE.LineSegments(g, mat);
		lines.name = "life-wires";
		lines.frustumCulled = false;
		infra.add(lines);
	}
	for (const s of sets) {
		s.mesh.instanceMatrix.needsUpdate = true;
		if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
		if (s.fadeAttr) s.fadeAttr.needsUpdate = true;
	}

	// Place everything that floats for a lake level: the marina just off the water's edge below
	// the ramp (along the shore, a gangway back to it), boats in its slips only where the water is
	// deep enough, anglers at the water's edge, loose boats and bird rafts on deep slots, fewer
	// boats when the lake is low. Hidden when the lake is.
	const DYN = [ boats, houseboats, docks, gangways, wakes, anglers, geese, ducks, pelicans ];
	const deep = (x, z, id, L, m = MARGIN) => bedAt(x, z, id) < L - m;
	function placeMarina(site, L, show) {
		const { b, ramp } = site;
		const id = b.r.id;
		const hideAll = () => {
			docks.hide(ramp.dockI);
			gangways.hide(ramp.gangI);
			for (const m of ramp.moor) m.set.hide(m.i);
			for (const p of ramp.dockPeople) anglers.hide(p.i);
			ramp.state = null;
		};
		const k = show ? ramp.bed.findIndex(([ , h ]) => h < L - SEEN * 0.6) : -1;
		if (k < 0) {
			hideAll();
			return;
		}
		// The water's edge as seen on the ramp line, and the lake's way out from it (down the bed).
		const [ wx, , wz ] = ramp.bed[k];
		const g = 60 * K;
		let nx = -(bedAt(wx + g, wz, id) - bedAt(wx - g, wz, id));
		let nz = -(bedAt(wx, wz + g, id) - bedAt(wx, wz - g, id));
		let nl = Math.hypot(nx, nz);
		if (!Number.isFinite(nl) || nl < 1e-6) {
			[ nx, nz ] = ramp.into;
			nl = 1;
		}
		nx /= nl;
		nz /= nl;
		// Lean toward the ramp line so the marina stays by the ramp.
		nx = nx * 0.6 + ramp.into[0] * 0.4;
		nz = nz * 0.6 + ramp.into[1] * 0.4;
		nl = Math.hypot(nx, nz);
		nx /= nl;
		nz /= nl;
		const tx = -nz;
		const tz = nx;
		const kd = CAP.dock * K;
		const at = (ox, oz, lx, lz) => [ ox + nx * lx + tx * lz, oz + nz * lx + tz * lz ];
		let o = null;
		for (let s = 15; s <= GANGWAY_MAX && !o; s += 15) {
			const ox = wx + nx * s * K;
			const oz = wz + nz * s * K;
			if (!deep(ox, oz, id, L, SEEN)) continue;
			const corners = [ [ 0, DOCK.len / 2 ], [ 0, -DOCK.len / 2 ], [ DOCK.walk / 2 + DOCK.finger, DOCK.len / 2 ], [ DOCK.walk / 2 + DOCK.finger, -DOCK.len / 2 ] ];
			if (corners.every(([ lx, lz ]) => deep(...at(ox, oz, lx * kd, lz * kd), id, L, SEEN * 0.7))) o = [ ox, oz, s ];
		}
		if (!o) {
			hideAll();
		} else {
			const [ ox, oz, s ] = o;
			const ang = face(nx, nz);
			docks.put(ramp.dockI, ox, L, oz, ang);
			// Gangway from the water's edge to the walkway's shore side.
			const len = Math.max(1, s - DOCK.walk / 2 * CAP.dock);
			gangways.put(ramp.gangI, wx, L, wz, ang, 1, 0, len / CAP.dock);
			const fill = Math.max(0, Math.min(1, (L - b.levelFor(0)) / (b.P - b.levelFor(0))));
			for (const m of ramp.moor) {
				const [ mx, mz ] = at(ox, oz, m.x, m.z);
				const half = (m.house ? 9 * CAP.houseboat : 3 * CAP.boat) * K;
				const ok = (m.house || m.rank < 0.35 + 0.65 * fill) && [ 0, half, -half ].every((h) => deep(mx + nx * h, mz + nz * h, id, L, SEEN * 0.7));
				if (ok) m.set.put(m.i, mx, L, mz, ang);
				else m.set.hide(m.i);
			}
			for (const p of ramp.dockPeople) {
				const [ mx, mz ] = at(ox, oz, p.x, p.z);
				anglers.put(p.i, mx, L, mz, face(tx, tz) + (p.z > 0 ? 0 : Math.PI));
			}
			ramp.state = { dock: [ ox, oz ], edge: [ wx, wz ], gangway: s, level: L };
		}
	}
	function placeWater(site, L, show) {
		const { b, ramp, water } = site;
		if (ramp) placeMarina(site, L, show);
		const fill = Math.max(0, Math.min(1, (L - b.levelFor(0)) / (b.P - b.levelFor(0))));
		const free = water.slots.filter((s) => s.bedMax < L - SEEN);
		const used = [];
		const take = (minGap) => {
			for (const s of free) {
				if (used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < minGap)) continue;
				used.push(s);
				return s;
			}
			return null;
		};
		// Fewer boats out on a low lake.
		const nOut = Math.max(2, Math.round(water.loose.length * (0.3 + 0.7 * fill)));
		water.live = [];
		for (const boat of water.loose) {
			const s = show && boat.rank < nOut ? take(0.7) : null;
			if (s) {
				boat.set.put(boat.i, s.x, L, s.z, boat.ang);
				if (boat.moving) water.live.push({ boat, cx: s.x, cz: s.z, L });
				else if (boat.wake >= 0) wakes.hide(boat.wake);
			} else {
				boat.set.hide(boat.i);
				if (boat.wake >= 0) wakes.hide(boat.wake);
			}
		}
		for (const raft of water.rafts) {
			const s = show ? take(0.7) : null;
			for (const bird of raft.birds) {
				if (s) raft.set.put(bird.i, s.x + bird.dx, L, s.z + bird.dz, raft.heading + bird.ang);
				else raft.set.hide(bird.i);
			}
		}
	}
	// A boat under way at time t: on its loop round the slot, the wake trailing behind.
	function steer(live, t) {
		const { boat, cx, cz, L } = live;
		const a = boat.ph + t * boat.w;
		const x = cx + Math.cos(a) * boat.rad;
		const z = cz + Math.sin(a) * boat.rad;
		const hx = -Math.sin(a) * Math.sign(boat.w);
		const hz = Math.cos(a) * Math.sign(boat.w);
		boat.set.put(boat.i, x, L, z, face(hx, hz));
		wakes.put(boat.wake, x, L, z, face(hx, hz));
	}

	// Nothing floats until its lake's level is known.
	for (const site of sites) placeWater(site, site.b.P, false);

	let levels = null;
	let shown = null;
	let visible = false;
	let dirty = true;
	let clock = 0;
	const near = new Set();
	function refreshWater(force = false) {
		if (!levels) return;
		let changed = false;
		sites.forEach((site, i) => {
			if (!near.has(i)) return;
			const L = levels[i];
			const vis = shown ? Boolean(shown[i]) : true;
			if (!force && site.lastLevel !== null && Math.abs(site.lastLevel - L) < 1e-4 && site.lastVis === vis) return;
			site.lastLevel = L;
			site.lastVis = vis;
			placeWater(site, L, vis);
			for (const live of site.water.live) steer(live, clock);
			changed = true;
		});
		if (changed) for (const s of DYN) s.mesh.instanceMatrix.needsUpdate = true;
	}
	const camPos = new THREE.Vector3();

	return {
		group,
		infra,
		wild,
		stats,
		setUnsquash(v) {
			unsquash.value = v;
		},
		// Lake levels for the frame being drawn (each half of the compare split calls this).
		setLevels(lv, vis) {
			levels = lv;
			shown = vis;
			if (visible) refreshWater(dirty);
			dirty = !visible;
		},
		update(camera, groundBelow, vScale, time, viewHeight = 800) {
			clock = time;
			const p = camera.position;
			camPos.copy(p);
			pxScale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
			near.clear();
			let nearest = Infinity;
			sites.forEach((s, i) => {
				const dd = Math.hypot(p.x - s.center[0], p.z - s.center[1]);
				nearest = Math.min(nearest, dd);
				if (dd < SHOW_WITHIN + s.b.Lu * 2) near.add(i);
			});
			const was = visible;
			visible = nearest < SHOW_WITHIN && p.y - groundBelow < SHOW_HEIGHT;
			group.visible = visible;
			if (!visible) return;
			if (!was || dirty) {
				for (const s of sites) s.lastLevel = null;
				refreshWater(true);
				dirty = false;
			}
			// Boats under way and birds wheeling over the canyons (near dams only).
			for (const i of near) {
				const site = sites[i];
				for (const live of site.water.live) steer(live, time);
				for (const bird of site.soar) {
					const a = bird.ph + time * bird.w;
					const x = bird.cx + Math.cos(a) * bird.rad;
					const z = bird.cz + Math.sin(a) * bird.rad;
					// Tangent heading, banked into the turn.
					const hx = -Math.sin(a) * Math.sign(bird.w);
					const hz = Math.cos(a) * Math.sign(bird.w);
					raptors.put(bird.i, x, bird.base + bird.lift / vScale, z, face(hx, hz), 1, 0.35 * Math.sign(bird.w));
				}
			}
			for (const s of [ boats, wakes, raptors ]) s.mesh.instanceMatrix.needsUpdate = true;
		},
		// For tests: what is placed, and where the floating things are against the water.
		debug() {
			const water = [];
			const marinas = [];
			// Sites in view range (the rest are not drawn and wait for their next close view).
			sites.forEach((site, i) => {
				if (!levels || !near.has(i)) return;
				const L = levels[i];
				const id = site.b.r.id;
				const list = [];
				for (const m of site.ramp?.moor ?? []) list.push([ m.set, m.i ]);
				for (const m of site.water.loose) list.push([ m.set, m.i ]);
				for (const raft of site.water.rafts) for (const bird of raft.birds) list.push([ raft.set, bird.i ]);
				if (site.ramp) list.push([ docks, site.ramp.dockI ]);
				for (const [ set, k ] of list) {
					const w = set.where[k];
					if (!w) continue;
					water.push({ id, kind: set.name, x: w[0], z: w[2], level: L, y: w[1], bed: bedAt(w[0], w[2], id) });
				}
				if (site.ramp) {
					const st = site.ramp.state;
					marinas.push({ id, concrete: site.ramp.concreteLen, dock: Boolean(st), at: st ? st.dock : null, gangway: st ? st.gangway : null,
						// Height of the bed over the water at the gangway's shore end (land-local units).
						edgeAbove: st ? (basins.surfaceAt(st.edge[0], st.edge[1])?.h ?? Infinity) - L : null });
				}
			});
			// Independent of placement: the true grade under everything standing on the ground
			// (not birds in the air or anything afloat), wherever it is now.
			const skip = new Set();
			for (const site of sites) for (const p of site.ramp?.dockPeople ?? []) skip.add(`anglers:${p.i}`);
			let groundMax = 0;
			let groundN = 0;
			for (const set of [ anglers, towers, deer, cattle ]) {
				set.where.forEach((w, k) => {
					if (!w || skip.has(`${set.name}:${k}`)) return;
					groundN++;
					groundMax = Math.max(groundMax, grade(w[0], w[2]));
				});
			}
			// What is on screen now: per set, how many instances pass the size test (drawn) and the
			// smallest of those, from the camera and the models' own bounding boxes.
			const drawn = {};
			if (visible) {
				for (const s of sets) {
					let n = 0;
					let min = Infinity;
					s.where.forEach((w) => {
						if (!w) return;
						const wp = v3.set(w[0], w[1], w[2]).applyMatrix4(group.matrixWorld);
						const px = s.size * pxScale.value / Math.max(1e-4, camPos.distanceTo(wp));
						if (px > MIN_PX[0] && camPos.distanceTo(wp) < FADE_FAR) {
							n++;
							min = Math.min(min, px);
						}
					});
					drawn[s.name] = { n, min };
				}
			}
			const caps = Object.fromEntries(sets.map((s) => [ s.name, +s.exaggeration.toFixed(2) ]));
			const uniforms = { pxScale: pxScale.value, sizes: Object.fromEntries(sets.map((s) => [ s.name, s.size ])) };
			return { stats, visible, water, marinas, groundMax, groundN, drawn, caps, uniforms, metresPerUnit: 1 / K, fade: [ FADE_NEAR, FADE_FAR ], show: SHOW_WITHIN, minPx: MIN_PX };
		},
	};
}
