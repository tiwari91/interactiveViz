// Life round each dam, for close views: a crest road with traffic, an overlook with visitors
// and a car park, transmission towers leaving the powerhouse, a boat ramp whose floating dock
// and boats follow the month's lake level, anglers, waterbirds, circling vultures, deer at the
// forest edge and cattle on foothill grass. Instanced and low-poly; it fades out with distance
// and is skipped entirely beyond a close view, so the state overview never draws it.
import { EXAGGERATION } from "./world.js";
import { regionOf, pelicanLake } from "./regions.js";

// Props are drawn at one common detail scale, in world units per metre. The terrain is about
// 1.15 km per unit, so life size would be under a pixel; at this scale a car fills a lane of
// the crest road and sits beside the riverside trees the way it would in life (the trees and
// the dams are drawn at the same exaggeration).
export const DETAIL = 0.045;
// People and animals are drawn a little larger again so they read at close zoom.
const SIZE = { person: 1.35, bird: 1.8, beast: 1.4, vehicle: 1, boat: 1 };
const FADE_NEAR = 45;
const FADE_FAR = 85;
// Beyond this distance from every dam (and this height over the ground) nothing is drawn.
const SHOW_WITHIN = 110;
const SHOW_HEIGHT = 90;
// Steepest true grade (rise over run, before the relief exaggeration) anything may stand on.
export const GENTLE = 0.2;
// Water at least this deep (land-local units, ~6 m) under every boat and waterbird.
const MARGIN = 0.04;
const WHITE = 0xffffff;

function rng(seed) {
	let s = Math.abs(Math.floor(seed)) % 2147483646 + 1;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Box-built models in metres (forward +x, up +y, ground or waterline at y = 0), merged into one
// flat-shaded, vertex-coloured geometry and scaled to world units. Pure white parts take each
// instance's colour (a shirt, a car body, a hull); everything else keeps its own colour.
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
			return out;
		},
	};
	return api;
}

const M = (THREE) => model(THREE);

function personGeom(THREE, angler) {
	const m = M(THREE)
		.box(0.26, 0.85, 0.32, 0, 0.425, 0, 0x2f3542)
		.box(0.3, 0.62, 0.46, 0, 1.16, 0, WHITE)
		.box(0.22, 0.24, 0.22, 0, 1.6, 0, 0xc99a74);
	// A rod held out over the water.
	if (angler) m.box(2.8, 0.05, 0.05, 1.25, 1.75, 0.15, 0x26221e, { rz: 0.45 });
	return m.build(DETAIL * SIZE.person);
}

function carGeom(THREE, pickup) {
	const m = M(THREE);
	m.box(pickup ? 5.2 : 4.4, 0.32, 1.84, 0, 0.18, 0, 0x1e1f21);
	if (pickup) {
		m.box(5.2, 0.62, 1.9, 0, 0.62, 0, WHITE).box(2.1, 0.62, 1.74, 0.75, 1.24, 0, 0x2a3139);
	} else {
		m.box(4.4, 0.6, 1.8, 0, 0.6, 0, WHITE).box(2.3, 0.52, 1.6, -0.25, 1.16, 0, 0x2a3139);
	}
	return m.build(DETAIL * SIZE.vehicle);
}

// Narrow the bow (+x end) of a hull to a point and lift its keel.
const bow = (x, y, z, w) => {
	const t = Math.max(0, x / (w / 2));
	return [ x, y + (y < 0 ? t * 0.3 : 0), z * (1 - 0.75 * t * t) ];
};

function boatGeom(THREE) {
	return M(THREE)
		.box(6.2, 0.9, 2.3, 0, 0.1, 0, WHITE, { shape: bow })
		.box(5, 0.08, 2.0, -0.3, 0.58, 0, 0xe3ddcf)
		.box(0.9, 0.7, 1.3, -0.4, 0.95, 0, 0x2b3038)
		.build(DETAIL * SIZE.boat);
}

function houseboatGeom(THREE) {
	return M(THREE)
		.box(16, 1.1, 5.2, 0, 0.15, 0, 0xd9d6cf, { shape: bow })
		.box(11.5, 2.6, 4.4, -1.2, 1.9, 0, WHITE)
		.box(12, 0.2, 4.8, -1.2, 3.3, 0, 0x7d838b)
		.box(0.3, 1.2, 4.2, 4.65, 1.3, 0, 0x3a3f46)
		.build(DETAIL * SIZE.boat);
}

// A floating dock: a walkway running out from the shore (+x) with slips either side.
function dockGeom(THREE) {
	const m = M(THREE).box(34, 0.5, 2.6, 17, 0.15, 0, 0x8f8576);
	for (let k = 0; k < 4; k++) {
		m.box(1.6, 0.45, 9, 10 + k * 7, 0.15, 5.6, 0x8f8576).box(1.6, 0.45, 9, 10 + k * 7, 0.15, -5.6, 0x8f8576);
	}
	return m.build(DETAIL);
}

// Pylons are drawn at 0.7 of the common scale so they do not tower over the smaller dams.
const TOWER_K = 0.7;
// A lattice pylon read as four splayed legs, cross-arms and a peak.
function towerGeom(THREE) {
	const H = 38;
	const m = M(THREE);
	for (const [ sx, sz ] of [ [ 1, 1 ], [ 1, -1 ], [ -1, 1 ], [ -1, -1 ] ]) {
		m.box(0.6, H, 0.6, 0, H / 2, 0, 0x8b9298, { shape: (x, y, z) => {
			const t = (y + H / 2) / H;
			const spread = 3.4 * (1 - t) + 0.9 * t;
			return [ x + sx * spread, y, z + sz * spread ];
		} });
	}
	for (const y of [ 10, 20, 29 ]) m.box(4.6 - y * 0.08, 0.35, 4.6 - y * 0.08, 0, y, 0, 0x8b9298, { shape: (x, yy, z) => [ x, yy, z ] });
	m.box(0.8, 0.7, 17, 0, 31, 0, 0x8b9298).box(0.8, 0.7, 12, 0, 36, 0, 0x8b9298).box(0.5, 5, 0.5, 0, H + 2, 0, 0x8b9298);
	return m.build(DETAIL * TOWER_K);
}
const TOWER_ARMS = [ [ 31, 8.2 ], [ 31, -8.2 ], [ 36, 5.8 ], [ 36, -5.8 ] ];

// Overlook: a viewing platform with a shade roof and a front rail.
function shelterGeom(THREE) {
	const m = M(THREE).box(9, 0.4, 6, 0, 0.2, 0, 0xb8b0a2);
	for (const [ x, z ] of [ [ -2.4, -1.8 ], [ 2.4, -1.8 ], [ -2.4, 1.8 ], [ 2.4, 1.8 ] ]) m.box(0.3, 3, 0.3, x, 1.9, z, 0x5c4635);
	m.box(6, 0.35, 4.4, 0, 3.5, 0, 0x6e5240).box(0.15, 1, 6, 4.4, 0.9, 0, 0x5c4635);
	return m.build(DETAIL);
}

// A kiosk-sized utility building and a toilet block, for the car parks.
function hutGeom(THREE) {
	return M(THREE).box(4, 2.8, 3, 0, 1.4, 0, 0xb9ae9a).box(4.6, 0.3, 3.6, 0, 2.95, 0, 0x5d554c).build(DETAIL);
}

function gooseGeom(THREE) {
	return M(THREE)
		.box(0.85, 0.32, 0.42, 0, 0.1, 0, 0x6f665b)
		.box(0.09, 0.42, 0.09, 0.38, 0.42, 0, 0x1d1c1b)
		.box(0.2, 0.1, 0.09, 0.45, 0.64, 0, 0x1d1c1b)
		.build(DETAIL * SIZE.bird);
}

function duckGeom(THREE) {
	return M(THREE)
		.box(0.55, 0.24, 0.3, 0, 0.08, 0, 0x8c857a)
		.box(0.16, 0.16, 0.14, 0.24, 0.27, 0, 0x2e5b3c)
		.build(DETAIL * SIZE.bird);
}

function pelicanGeom(THREE) {
	return M(THREE)
		.box(1.4, 0.5, 0.62, 0, 0.18, 0, 0xf1efe9)
		.box(0.45, 0.14, 0.64, -0.5, 0.36, 0, 0x26231f)
		.box(0.13, 0.5, 0.13, 0.6, 0.55, 0, 0xf1efe9)
		.box(0.5, 0.09, 0.1, 0.86, 0.76, 0, 0xe0993a, { rz: -0.25 })
		.build(DETAIL * SIZE.bird);
}

// A soaring turkey vulture or hawk: body and shallow-V wings spanning z.
function raptorGeom(THREE) {
	return M(THREE)
		.box(0.7, 0.18, 0.24, 0, 0, 0, 0x2b2622)
		.box(0.5, 0.05, 0.9, -0.02, 0.06, 0.55, 0x2b2622, { rx: -0.2 })
		.box(0.5, 0.05, 0.9, -0.02, 0.06, -0.55, 0x2b2622, { rx: 0.2 })
		.box(0.12, 0.1, 0.1, 0.4, 0.02, 0, 0xa8483b)
		.build(DETAIL * SIZE.bird);
}

// Quadrupeds; the head and neck (x beyond the pivot) dip when grazing.
function deerGeom(THREE) {
	const m = M(THREE).box(1.3, 0.55, 0.45, 0, 1.0, 0, 0x8a6a4a);
	for (const [ x, z ] of [ [ 0.5, 0.15 ], [ 0.5, -0.15 ], [ -0.5, 0.15 ], [ -0.5, -0.15 ] ]) m.box(0.1, 0.8, 0.1, x, 0.4, z, 0x6a5038);
	m.box(0.18, 0.55, 0.18, 0.72, 1.4, 0, 0x8a6a4a, { rz: -0.35 }).box(0.34, 0.18, 0.16, 0.95, 1.65, 0, 0x7d5f42).box(0.12, 0.14, 0.12, -0.68, 1.12, 0, 0xe8e0d0);
	return m.build(DETAIL * SIZE.beast);
}
const DEER_PIVOT = [ 0.6, 1.15 ];

function cowGeom(THREE) {
	const m = M(THREE).box(2.0, 0.95, 0.8, 0, 1.05, 0, WHITE);
	for (const [ x, z ] of [ [ 0.75, 0.25 ], [ 0.75, -0.25 ], [ -0.75, 0.25 ], [ -0.75, -0.25 ] ]) m.box(0.18, 0.62, 0.18, x, 0.31, z, 0x2a2420);
	m.box(0.45, 0.42, 0.36, 1.2, 1.2, 0, WHITE).box(0.2, 0.3, 0.3, 1.43, 1.12, 0, 0xe2dcd0);
	return m.build(DETAIL * SIZE.beast);
}
const COW_PIVOT = [ 0.95, 1.25 ];

export function createLife(THREE, { basins, dams, outflow, router, world, riparian, shared, quality }) {
	const group = new THREE.Group();
	group.name = "life";
	const infra = new THREE.Group();
	const wild = new THREE.Group();
	group.add(infra, wild);
	const unsquash = { value: 1 };
	const stats = { sites: 0, cars: 0, people: 0, anglers: 0, boats: 0, towers: 0, overlooks: 0, ramps: 0, waterbirds: 0, raptors: 0, deer: 0, cattle: 0, maxGrade: 0, rejected: 0 };
	const off = {
		group, infra, wild, stats, setUnsquash() {}, update() {}, setLevels() {},
		debug: () => ({ stats, visible: false, water: [] }),
	};
	if (quality !== "high") return off;

	const high = true;
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
	// group vertically), shrink away with distance, tint only their white parts per instance, and
	// animate off the shared clock (which stands still under reduced motion).
	const material = (anim = "") => {
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, flatShading: true });
		mat.onBeforeCompile = (sh) => {
			sh.uniforms.uUnsquash = unsquash;
			sh.uniforms.uTime = shared.uTime;
			sh.vertexShader = sh.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uUnsquash;\nuniform float uTime;\nattribute float aPhase;")
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
		transformed *= 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, distance(base, cameraPosition));
	}`);
		};
		return mat;
	};
	const f = (v) => v.toFixed(4);
	const ANIM = {
		// Wings beat in bursts between long glides.
		flap: `{ float beat = sin(uTime * 7.0 + aPhase * 6.2832) * step(0.55, sin(uTime * 0.45 + aPhase * 17.0)); transformed.y += abs(transformed.z) * beat * 0.7; }`,
		// Slow drift on the water.
		drift: `{ float r = ${f(0.1)}; transformed.x += sin(uTime * 0.21 + aPhase * 6.2832) * r; transformed.z += cos(uTime * 0.16 + aPhase * 9.1) * r; }`,
		graze: (p, k) => `{ float g = smoothstep(-0.3, 0.5, sin(uTime * 0.35 + aPhase * 6.2832)); float d = max(0.0, transformed.x - ${f(p[0] * k)}); transformed.y -= g * d * 1.5; transformed.x -= g * d * 0.35; }`,
	};

	const sets = [];
	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const v3 = new THREE.Vector3();
	const s3 = new THREE.Vector3();
	const col = new THREE.Color();
	const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
	function instanced(name, geom, cap, parent, anim = "") {
		const phase = new Float32Array(cap);
		const r = rng(cap * 31 + name.length * 7);
		for (let i = 0; i < cap; i++) phase[i] = r();
		geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
		const mesh = new THREE.InstancedMesh(geom, material(anim), cap);
		mesh.name = `life-${name}`;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = high;
		mesh.count = 0;
		mesh.setColorAt(0, col.set(WHITE));
		parent.add(mesh);
		const set = {
			name, mesh, cap, n: 0, where: [],
			add(x, y, z, ang, color = WHITE, sc = 1) {
				if (this.n >= cap) return -1;
				const i = this.n++;
				this.put(i, x, y, z, ang, sc);
				mesh.setColorAt(i, col.set(color));
				mesh.count = this.n;
				return i;
			},
			put(i, x, y, z, ang, sc = 1, roll = 0) {
				q.setFromAxisAngle(up, ang);
				if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(v3.set(1, 0, 0), roll));
				m4.compose(v3.set(x, y, z), q, s3.set(sc, sc, sc));
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

	const people = instanced("people", personGeom(THREE, false), 1400, infra);
	const anglers = instanced("anglers", personGeom(THREE, true), 500, infra);
	const cars = instanced("cars", carGeom(THREE, false), 700, infra);
	const pickups = instanced("pickups", carGeom(THREE, true), 400, infra);
	const boats = instanced("boats", boatGeom(THREE), 500, infra);
	const houseboats = instanced("houseboats", houseboatGeom(THREE), 120, infra);
	const docks = instanced("docks", dockGeom(THREE), 60, infra);
	const towers = instanced("towers", towerGeom(THREE), 400, infra);
	const shelters = instanced("shelters", shelterGeom(THREE), 60, infra);
	const huts = instanced("huts", hutGeom(THREE), 120, infra);
	const geese = instanced("geese", gooseGeom(THREE), 1600, wild, ANIM.drift);
	const ducks = instanced("ducks", duckGeom(THREE), 1600, wild, ANIM.drift);
	const pelicans = instanced("pelicans", pelicanGeom(THREE), 700, wild, ANIM.drift);
	const raptors = instanced("raptors", raptorGeom(THREE), 160, wild, ANIM.flap);
	const deer = instanced("deer", deerGeom(THREE), 400, wild, ANIM.graze(DEER_PIVOT, DETAIL * SIZE.beast));
	const cattle = instanced("cattle", cowGeom(THREE), 900, wild, ANIM.graze(COW_PIVOT, DETAIL * SIZE.beast));

	const SHIRTS = [ 0xc8442f, 0x2f6fb0, 0xe0b33a, 0xf0ede6, 0x3c7f4e, 0x7a4a8c, 0xe07b39, 0x29a0a8 ];
	const PAINT = [ 0xf2f0ea, 0xb8bcc0, 0x2a2d31, 0x8f2a24, 0x2f4f7a, 0x6f7276, 0xd9d4c4, 0x3d5a40 ];
	const HULLS = [ 0xf4f2ec, 0xf4f2ec, 0xc23b2c, 0x2c5a8f, 0xe5c34a, 0x3c3f44 ];
	const COWS = [ 0x1f1b18, 0x1f1b18, 0x5a3424, 0x7a4630, 0x2b2420 ];

	// Draped ground pieces (car parks, ramps, access roads) in one static mesh.
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
	// A car park: an asphalt pad following the ground, parking bays in a row.
	const lot = (x, z, ang, w, d) => {
		const ca = Math.cos(ang);
		const sa = Math.sin(ang);
		const P = (i, j) => {
			const px = x + ca * i - sa * j;
			const pz = z + sa * i + ca * j;
			return [ px, S(px, pz), pz ];
		};
		const N = 4;
		for (let i = 0; i < N; i++) {
			for (let j = 0; j < N; j++) {
				const i0 = -w / 2 + (w * i) / N;
				const i1 = -w / 2 + (w * (i + 1)) / N;
				const j0 = -d / 2 + (d * j) / N;
				const j1 = -d / 2 + (d * (j + 1)) / N;
				drapeQuad(P(i0, j0), P(i0, j1), P(i1, j1), P(i1, j0), 0x55585a);
			}
		}
		return P;
	};

	// Wires between towers: each vertex is ground height (scaled with the land) plus a lift
	// in true units, so the spans keep their sag whatever the relief scale.
	const wire = { pos: [], lift: [] };
	const span = (a, b, la, lb) => {
		const N = 10;
		for (let k = 0; k < N; k++) {
			for (const t of [ k / N, (k + 1) / N ]) {
				const sag = 4 * t * (1 - t) * Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.05;
				wire.pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
				wire.lift.push(la + (lb - la) * t - sag);
			}
		}
	};

	const sites = [];
	const r = rng(4242);
	const pick = (arr) => arr[Math.floor(r() * arr.length)];

	for (const { b, d } of damList) {
		const region = regionOf(b.r);
		const site = { b, d, region, center: d.center, movers: [], soar: [], water: null, lastLevel: null, lastVis: null };
		sites.push(site);
		stats.sites++;
		const ev = b.ev;
		const down = [ -b.eu[0], -b.eu[1] ];
		const scale = d.scale;

		// Traffic on the crest road: a car or two and a pickup driving slowly, in their lanes.
		// A concrete dam's gated spillway piers stand across the middle of the crest, so there each
		// car keeps to the stretch on one side of them.
		const road = d.road;
		const lengthOf = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
		const N = road.length - 1;
		const runs = d.concrete ? [ road.slice(0, Math.floor(N * 0.33) + 1), road.slice(Math.ceil(N * 0.67)) ] : [ road ];
		const roadLen = lengthOf(road);
		const nMove = roadLen > 6 ? 3 : roadLen > 2.5 ? 2 : 1;
		for (let k = 0; k < nMove; k++) {
			const set = k === 1 ? pickups : cars;
			const run = runs[k % runs.length];
			const i = set.add(run[0][0], d.crest, run[0][1], 0, pick(PAINT));
			if (i >= 0) site.movers.push({ set, i, road: run, s0: r(), speed: 0.22 + r() * 0.1, len: lengthOf(run) });
			stats.cars++;
		}

		// Overlook at one end of the crest: a car park on gentle ground beyond the abutment, a
		// viewing shelter, an access road from the crest, visitors looking at the dam.
		const endA = road[0];
		const endB = road[road.length - 1];
		const ends = [ [ endA, road[1] ], [ endB, road[road.length - 2] ] ];
		const sideFirst = r() < 0.5 ? ends : ends.reverse();
		let overlook = null;
		for (const [ e, prev ] of sideFirst) {
			const ox = e[0] - prev[0];
			const oz = e[1] - prev[1];
			const ol = Math.hypot(ox, oz) || 1;
			const out = [ ox / ol, oz / ol ];
			for (let tries = 0; tries < 60 && !overlook; tries++) {
				const dist = 1.2 + r() * 3.5;
				const lat = (r() - 0.5) * 3;
				const x = e[0] + out[0] * dist + down[0] * lat;
				const z = e[1] + out[1] * dist + down[1] * lat;
				const g = clearAt(x, z, 1.1);
				if (g < 0) continue;
				// The access road from the crest must not cross the spillway chute or a river.
				let crosses = false;
				for (let k = 1; k < 8 && !crosses; k++) {
					const px = e[0] + (x - e[0]) * k / 8;
					const pz = e[1] + (z - e[1]) * k / 8;
					crosses = outflow.nearChute(px, pz, 0.3) || onRiver(px, pz, 0.1);
				}
				if (crosses) continue;
				overlook = { x, z, g, e, out };
			}
			if (overlook) break;
		}
		if (overlook) {
			const { x, z, g, e, out } = overlook;
			// The shelter stands at the car park's front edge, toward the dam.
			const toDam = [ d.center[0] - x, d.center[1] - z ];
			const tl = Math.hypot(...toDam) || 1;
			const sx = x + toDam[0] / tl * 0.85;
			const sz = z + toDam[1] / tl * 0.85;
			const sg = clearAt(sx, sz, 0.3);
			claim(x, z, 0.75, g);
			site.overlook = [ x, z ];
			stats.overlooks++;
			const ang = face(out[0], out[1]);
			const W = 1.4;
			const D = 0.8;
			const P = lot(x, z, -ang, W, D);
			// Access road from the end of the crest to the car park.
			const pts = [];
			for (let k = 0; k <= 8; k++) {
				const t = k / 8;
				const px = e[0] + (x - e[0]) * t;
				const pz = e[1] + (z - e[1]) * t;
				pts.push([ px, Math.max(S(px, pz), k === 0 ? d.crest : -Infinity), pz ]);
			}
			strip(pts, d.roadWidth * 0.3, 0x5d5d5b, 0.025);
			// Parked cars in a row of bays.
			const nPark = 2 + Math.floor(r() * 4);
			for (let k = 0; k < nPark; k++) {
				const [ px, , pz ] = P(-W / 2 + 0.25 + k * 0.32, D * 0.2);
				if (gentle(px, pz, 0.12) < 0) continue;
				const set = r() < 0.3 ? pickups : cars;
				set.add(px, S(px, pz), pz, ang + Math.PI / 2 + (r() - 0.5) * 0.08, pick(PAINT));
				stats.cars++;
			}
			// Shelter at the front edge, facing the dam, with visitors at the rail.
			if (sg >= 0) {
				claim(sx, sz, 0.3, sg);
				shelters.add(sx, S(sx, sz), sz, face(toDam[0], toDam[1]));
				const nv = 2 + Math.floor(r() * 4);
				for (let k = 0; k < nv; k++) {
					const lx = sx + toDam[0] / tl * 0.12 + (toDam[1] / tl) * (k - nv / 2) * 0.07;
					const lz = sz + toDam[1] / tl * 0.12 - (toDam[0] / tl) * (k - nv / 2) * 0.07;
					if (gentle(lx, lz, 0.05) < 0) continue;
					people.add(lx, S(lx, lz), lz, face(toDam[0], toDam[1]) + (r() - 0.5) * 0.6, pick(SHIRTS));
					stats.people++;
				}
			}
			// Someone walking from the cars.
			const [ wx, , wz ] = P(W * 0.3, -D * 0.25);
			if (gentle(wx, wz, 0.05) >= 0) {
				people.add(wx, S(wx, wz), wz, r() * 6.28, pick(SHIRTS));
				stats.people++;
			}
		}

		// Transmission line: towers marching away from the powerhouse up and out of the canyon,
		// each on the nearest gentle spot to its stake; wires sag between them.
		{
			const [ px, py, pz, , ph ] = d.powerhouse;
			const side = (() => {
				const [ , v ] = b.toLocal(px, pz);
				return v >= 0 ? 1 : -1;
			})();
			const dir = [ ev[0] * side * 0.85 + down[0] * 0.5, ev[1] * side * 0.85 + down[1] * 0.5 ];
			const dl = Math.hypot(...dir);
			dir[0] /= dl;
			dir[1] /= dl;
			const lifts = TOWER_ARMS.map(([ y ]) => y * DETAIL * TOWER_K);
			let prev = [ px, py + ph, pz, 0.05 ];
			let prevArms = null;
			const towerAng = face(dir[0], dir[1]) + Math.PI / 2;
			for (let k = 1; k <= 7; k++) {
				const step = 2.6 * k + 0.8;
				let spot = null;
				for (let tries = 0; tries < 14 && !spot; tries++) {
					const jx = (r() - 0.5) * 1.2;
					const jz = (r() - 0.5) * 1.2;
					const x = px + dir[0] * step + jx;
					const z = pz + dir[1] * step + jz;
					const g = clearAt(x, z, 0.5);
					if (g >= 0) spot = [ x, z, g ];
				}
				if (!spot) continue;
				const [ x, z, g ] = spot;
				// A span longer than this would cross the lake or a whole valley: end the line.
				if (Math.hypot(x - prev[0], z - prev[2]) > 5.5) break;
				claim(x, z, 0.25, g);
				const y = S(x, z) - 0.02;
				towers.add(x, y, z, towerAng);
				stats.towers++;
				const ca = Math.cos(towerAng);
				const sa = Math.sin(towerAng);
				// Cross-arm tips in world space (local z across the line).
				// Cross-arm tips: the model's z axis turned by the tower's heading.
				const arms = TOWER_ARMS.map(([ , az ], n) => [ x + sa * az * DETAIL * TOWER_K, y, z + ca * az * DETAIL * TOWER_K, lifts[n] ]);
				if (prevArms) arms.forEach((a, n) => span(prevArms[n], a, prevArms[n][3], a[3]));
				else arms.forEach((a) => span([ prev[0], prev[1], prev[2] ], a, prev[3], a[3]));
				prevArms = arms;
				prev = [ x, y, z ];
			}
		}

		// Anglers on the banks just below the dam, facing the water.
		{
			const near = [];
			for (const cell of riverGrid.values()) {
				for (const p of cell) {
					const dd = Math.hypot(p.x - d.toePoint[0], p.z - d.toePoint[2]);
					if (p.kind === 0 && dd > 1.2 && dd < 7) near.push(p);
				}
			}
			const want = 2 + Math.floor(r() * 3);
			site.anglers = 0;
			for (let tries = 0; tries < 40 && site.anglers !== want && near.length; tries++) {
				const p = pick(near);
				const sd = r() < 0.5 ? -1 : 1;
				const o = p.half * 1.05 + 0.16;
				const x = p.x + p.sx * o * sd;
				const z = p.z + p.sz * o * sd;
				const sfc = basins.surfaceAt(x, z);
				if (sfc && (sfc.zone === "bowl" || sfc.zone === "shore")) continue;
				if (onDam(x, z, 0.1) || outflow.nearChute(x, z, 0.7)) continue;
				if (taken.some((t) => Math.hypot(t[0] - x, t[1] - z) < t[2] + 0.12)) continue;
				const g = gentle(x, z, 0.15);
				if (g < 0) continue;
				claim(x, z, 0.12, g);
				anglers.add(x, S(x, z), z, face(-p.sx * sd, -p.sz * sd), pick(SHIRTS));
				site.anglers++;
				stats.anglers++;
			}
		}

		// Soaring birds circling over the canyon below the dam.
		{
			const n = 1 + Math.floor(r() * 3);
			const cx = d.toePoint[0] + down[0] * (2 + scale);
			const cz = d.toePoint[2] + down[1] * (2 + scale);
			for (let k = 0; k < n; k++) {
				const i = raptors.add(cx, d.crest, cz, 0);
				if (i < 0) break;
				site.soar.push({ i, cx: cx + (r() - 0.5) * 2, cz: cz + (r() - 0.5) * 2, rad: 1.2 + r() * 1.6, lift: 2.2 + r() * 2.8, w: (0.18 + r() * 0.12) * (r() < 0.5 ? -1 : 1), ph: r() * 6.28, base: d.crest });
				stats.raptors++;
			}
		}

		// Boat ramp: from a gentle stretch of the full-pool shore straight down the bed, a car
		// park at its head; its floating dock, moored boats and anglers follow the water down.
		{
			let best = null;
			for (let k = 0; k < 40; k++) {
				const th = (k / 40) * Math.PI * 2;
				const dir = [ Math.cos(th), Math.sin(th) ];
				// March out from the lake centre to the shore.
				let sx = null;
				let sz = null;
				for (let t = 0.5; t < b.Lu * 2.4; t += 0.15) {
					const x = b.cx + dir[0] * t;
					const z = b.cz + dir[1] * t;
					const sfc = basins.surfaceAt(x, z);
					if (!sfc || sfc.zone !== "bowl" || sfc.basinId !== b.r.id) {
						sx = x;
						sz = z;
						break;
					}
				}
				if (sx === null) continue;
				const [ u ] = b.toLocal(sx, sz);
				if (u < b.dam.u + 1.5 || Math.hypot(sx - d.center[0], sz - d.center[1]) < d.halfWidth + 1.5) continue;
				const hx = sx + dir[0] * 1.3;
				const hz = sz + dir[1] * 1.3;
				const g = clearAt(hx, hz, 0.9);
				if (g < 0) continue;
				// A ramp wants a gentle bed: how far it runs before dropping 1.2 units.
				const bed = [];
				for (let t = 0; t < 4.5; t += 0.12) {
					const x = sx - dir[0] * t;
					const z = sz - dir[1] * t;
					const sfc = basins.surfaceAt(x, z);
					bed.push([ x, sfc ? sfc.h : S(x, z), z, sfc && sfc.zone === "bowl" && sfc.basinId === b.r.id ]);
				}
				const drop = bed[0][1] - bed[bed.length - 1][1];
				const score = -drop * 0.6 - g * 4 - Math.hypot(sx - d.center[0], sz - d.center[1]) * 0.03;
				if (!best || score > best.score) best = { score, sx, sz, dir, hx, hz, g, bed };
			}
			if (best) {
				const { sx, sz, dir, hx, hz, g } = best;
				// The ramp runs down the bed only as far as the lake goes (never up a far bank).
				const wet0 = best.bed.findIndex((p) => p[3]);
				const dry = best.bed.findIndex((p, i) => i > wet0 && !p[3]);
				const bed = dry > 0 ? best.bed.slice(0, dry) : best.bed;
				claim(hx, hz, 0.9, g);
				stats.ramps++;
				const ang = face(-dir[0], -dir[1]);
				const P = lot(hx, hz, -ang, 1.3, 0.8);
				strip([ [ hx - dir[0] * 0.5, S(hx - dir[0] * 0.5, hz - dir[1] * 0.5), hz - dir[1] * 0.5 ], [ sx + dir[0] * 0.15, S(sx + dir[0] * 0.15, sz + dir[1] * 0.15), sz + dir[1] * 0.15 ] ], 0.22, 0x8f8b84, 0.03);
				// The ramp itself, draped on the lake bed so it is under water when the lake is full.
				strip(bed.map(([ x, y, z ]) => [ x, y, z ]), 0.22, 0x9c968c, 0.035);
				for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
					const [ px, , pz ] = P(-0.45 + k * 0.32, -0.15);
					if (gentle(px, pz, 0.12) < 0) continue;
					pickups.add(px, S(px, pz), pz, ang + Math.PI / 2, pick(PAINT));
					stats.cars++;
				}
				const hutAt = P(0.5, 0.28);
				if (gentle(hutAt[0], hutAt[2], 0.12) >= 0) huts.add(hutAt[0], S(hutAt[0], hutAt[2]), hutAt[2], ang);
				const dockI = docks.add(sx, b.P, sz, ang);
				const moor = [];
				for (let k = 0; k < 4; k++) {
					for (const sd of [ 1, -1 ]) {
						if (r() < 0.35) continue;
						const set = b.Lu > 10 && region === "sierra" && r() < 0.45 ? houseboats : boats;
						const i = set.add(sx, b.P, sz, ang, set === houseboats ? WHITE : pick(HULLS));
						if (i >= 0) moor.push({ set, i, along: (10 + k * 7) * DETAIL, across: sd * (set === houseboats ? 11 : 6.5) * DETAIL });
					}
				}
				const dockPeople = [];
				for (let k = 0; k < 2; k++) {
					const i = anglers.add(sx, b.P, sz, ang, pick(SHIRTS));
					if (i >= 0) dockPeople.push({ i, along: (20 + k * 12) * DETAIL, across: (k ? 1 : -1) * 0.9 * DETAIL });
				}
				const shoreAnglers = [];
				for (let k = 0; k < 2; k++) {
					const i = anglers.add(sx, b.P, sz, ang, pick(SHIRTS));
					if (i >= 0) shoreAnglers.push({ i, side: (k ? 1 : -1) * (0.45 + r() * 0.35) });
				}
				site.ramp = { dir, bed, dockI, moor, dockPeople, shoreAnglers, ang };
				stats.boats += moor.length;
				stats.anglers += dockPeople.length + shoreAnglers.length;
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
				for (const [ a, c ] of [ [ 0, 0 ], [ 0.4, 0 ], [ -0.4, 0 ], [ 0, 0.4 ], [ 0, -0.4 ] ]) {
					const sfc = basins.surfaceAt(x + a, z + c);
					if (!sfc || sfc.zone !== "bowl" || sfc.basinId !== b.r.id) {
						ok = false;
						break;
					}
					bedMax = Math.max(bedMax, sfc.h);
				}
				if (ok) slots.push({ x, z, bedMax, pref: r() });
			}
			slots.sort((a, c) => a.pref - c.pref);
			const loose = [];
			const nLoose = Math.min(8, 1 + Math.round(b.Lu / 3));
			for (let k = 0; k < nLoose; k++) {
				const set = b.Lu > 10 && region === "sierra" && k % 3 === 2 ? houseboats : boats;
				const i = set.add(b.cx, b.P, b.cz, r() * 6.28, set === houseboats ? WHITE : pick(HULLS));
				if (i >= 0) loose.push({ set, i, ang: r() * 6.28 });
			}
			stats.boats += loose.length;
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
					const rr = Math.sqrt(r()) * 0.24;
					birds.push({ i, dx: Math.cos(a) * rr, dz: Math.sin(a) * rr, ang: r() * 0.8 });
				}
				stats.waterbirds += birds.length;
				rafts.push({ set: kind, birds, heading: r() * 6.28 });
			}
			site.water = { slots, loose, rafts };
		}

		// Deer at the forest edge (mountains), cattle grazing open foothill grass.
		if (region === "sierra" || region === "foothill") {
			const trees = riparian.trees().filter((t) => Math.hypot(t.x - b.cx, t.z - b.cz) < b.Lu * 1.6 + 10);
			const isDeer = region === "sierra";
			const herds = isDeer ? 3 : 3;
			for (let h = 0; h < herds; h++) {
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
					if (clearAt(x, z, 0.7, isDeer ? GENTLE : 0.14) >= 0) c = [ x, z ];
				}
				if (!c) continue;
				const n = isDeer ? 2 + Math.floor(r() * 3) : 6 + Math.floor(r() * 9);
				const heading = r() * 6.28;
				for (let j = 0; j < n; j++) {
					const a = r() * 6.28;
					const rr = Math.sqrt(r()) * (isDeer ? 0.4 : 0.9);
					const x = c[0] + Math.cos(a) * rr;
					const z = c[1] + Math.sin(a) * rr;
					const g = clearAt(x, z, 0.06, isDeer ? GENTLE : 0.14);
					if (g < 0) continue;
					if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.3)) continue;
					claim(x, z, 0.06, g);
					const set = isDeer ? deer : cattle;
					set.add(x, S(x, z), z, heading + (r() - 0.5) * 1.6, isDeer ? WHITE : pick(COWS));
					stats[isDeer ? "deer" : "cattle"]++;
				}
			}
		}
	}

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
		const mat = new THREE.LineBasicMaterial({ color: 0x2c2f33, transparent: true, opacity: 0.7 });
		mat.onBeforeCompile = (sh) => {
			sh.uniforms.uUnsquash = unsquash;
			sh.vertexShader = sh.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uUnsquash;\nattribute float aLift;\nvarying float vFade;")
				.replace("#include <begin_vertex>", "#include <begin_vertex>\n\ttransformed.y += aLift * uUnsquash;")
				.replace("#include <project_vertex>", "#include <project_vertex>\n\tvFade = 1.0 - smoothstep(" + FADE_NEAR.toFixed(1) + ", " + FADE_FAR.toFixed(1) + ", length(mvPosition.xyz));");
			sh.fragmentShader = sh.fragmentShader
				.replace("#include <common>", "#include <common>\nvarying float vFade;")
				.replace("#include <output_fragment>", "#include <output_fragment>\n\tgl_FragColor.a *= vFade;");
		};
		const lines = new THREE.LineSegments(g, mat);
		lines.name = "life-wires";
		lines.frustumCulled = false;
		infra.add(lines);
	}
	for (const s of sets) {
		s.mesh.instanceMatrix.needsUpdate = true;
		if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
	}

	// Place everything that floats for a lake level: the dock where the water meets the ramp
	// (boats in its slips only where the water is deep enough), anglers at that waterline,
	// loose boats and bird rafts on slots deep enough for them. Hidden when the lake is.
	const DYN = [ boats, houseboats, docks, anglers, geese, ducks, pelicans ];
	const bedAt = (x, z, id) => {
		const sfc = basins.surfaceAt(x, z);
		return sfc && sfc.zone === "bowl" && sfc.basinId === id ? sfc.h : Infinity;
	};
	function placeWater(site, L, show) {
		const { b, ramp, water } = site;
		const id = b.r.id;
		if (ramp) {
			// First ramp sample deep enough to float the dock.
			let k = ramp.bed.findIndex(([ , h, , wet ]) => wet && h < L - MARGIN);
			const dockOk = show && k >= 0;
			const [ dx0, dz0 ] = [ -ramp.dir[0], -ramp.dir[1] ];
			if (dockOk) {
				const [ x, , z ] = ramp.bed[k];
				docks.put(ramp.dockI, x, L, z, ramp.ang);
				for (const m of ramp.moor) {
					const mx = x + dx0 * m.along - dz0 * m.across;
					const mz = z + dz0 * m.along + dx0 * m.across;
					const half = (m.set === houseboats ? 8 : 3.2) * DETAIL;
					const deep = [ [ mx, mz ], [ mx + dx0 * half, mz + dz0 * half ], [ mx - dx0 * half, mz - dz0 * half ] ].every(([ px, pz ]) => bedAt(px, pz, id) < L - MARGIN);
					if (deep) m.set.put(m.i, mx, L, mz, ramp.ang);
					else m.set.hide(m.i);
				}
				for (const p of ramp.dockPeople) {
					const mx = x + dx0 * p.along - dz0 * p.across;
					const mz = z + dz0 * p.along + dx0 * p.across;
					anglers.put(p.i, mx, L, mz, ramp.ang + Math.PI / 2 * (p.across > 0 ? -1 : 1));
				}
			} else {
				docks.hide(ramp.dockI);
				for (const m of ramp.moor) m.set.hide(m.i);
				for (const p of ramp.dockPeople) anglers.hide(p.i);
			}
			// Anglers either side of the ramp at the waterline, on the exposed bed if it is gentle.
			k = ramp.bed.findIndex(([ , h ]) => h < L);
			for (const p of ramp.shoreAnglers) {
				if (!show || k < 1) {
					anglers.hide(p.i);
					continue;
				}
				const [ x0, , z0 ] = ramp.bed[Math.max(0, k - 2)];
				const x = x0 - dz0 * p.side;
				const z = z0 + dx0 * p.side;
				const h = basins.surfaceAt(x, z)?.h ?? S(x, z);
				if (h < L + 0.03 || gentle(x, z, 0.12) < 0) {
					anglers.hide(p.i);
					continue;
				}
				anglers.put(p.i, x, h, z, ramp.ang);
			}
		}
		const free = water.slots.filter((s) => s.bedMax < L - MARGIN);
		const used = [];
		const take = (minGap) => {
			for (const s of free) {
				if (used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < minGap)) continue;
				used.push(s);
				return s;
			}
			return null;
		};
		for (const boat of water.loose) {
			const s = show ? take(0.9) : null;
			if (s) boat.set.put(boat.i, s.x, L, s.z, boat.ang);
			else boat.set.hide(boat.i);
		}
		for (const raft of water.rafts) {
			const s = show ? take(0.9) : null;
			for (const bird of raft.birds) {
				if (s) raft.set.put(bird.i, s.x + bird.dx, L, s.z + bird.dz, raft.heading + bird.ang);
				else raft.set.hide(bird.i);
			}
		}
	}

	// Nothing floats until its lake's level is known.
	for (const site of sites) placeWater(site, site.b.P, false);

	let levels = null;
	let shown = null;
	let visible = false;
	let dirty = true;
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
			changed = true;
		});
		if (changed) for (const s of DYN) s.mesh.instanceMatrix.needsUpdate = true;
	}

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
		update(camera, groundBelow, vScale, time) {
			const p = camera.position;
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
			// Traffic on the crests and birds wheeling over the canyons (near dams only).
			for (const i of near) {
				const site = sites[i];
				for (const m of site.movers) {
					const road = m.road;
					const total = m.len * 2;
					let s = ((m.s0 * total + time * m.speed) % total + total) % total;
					let dir = 1;
					if (s > m.len) {
						s = total - s;
						dir = -1;
					}
					// Walk the polyline to arc length s.
					let k = 1;
					let acc = 0;
					for (; k < road.length; k++) {
						const l = Math.hypot(road[k][0] - road[k - 1][0], road[k][1] - road[k - 1][1]);
						if (acc + l >= s) break;
						acc += l;
					}
					k = Math.min(k, road.length - 1);
					const a = road[k - 1];
					const c = road[k];
					const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
					const t = Math.min(1, (s - acc) / l);
					const tx = (c[0] - a[0]) / l * dir;
					const tz = (c[1] - a[1]) / l * dir;
					// Keep right: offset across the road by a quarter of its width.
					const lane = site.d.roadWidth * 0.22;
					const x = a[0] + (c[0] - a[0]) * t - tz * lane;
					const z = a[1] + (c[1] - a[1]) * t + tx * lane;
					m.set.put(m.i, x, site.d.crest, z, face(tx, tz));
				}
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
			cars.mesh.instanceMatrix.needsUpdate = true;
			pickups.mesh.instanceMatrix.needsUpdate = true;
			raptors.mesh.instanceMatrix.needsUpdate = true;
		},
		// For tests: what is placed, and where the floating things are against the water.
		debug() {
			const water = [];
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
			});
			// Independent of placement: the true grade under everything standing on the ground
			// (not traffic on the crests, birds in the air or anything afloat), wherever it is now.
			const skip = new Set();
			for (const site of sites) {
				for (const m of site.movers) skip.add(`${m.set.name}:${m.i}`);
				for (const p of site.ramp?.dockPeople ?? []) skip.add(`anglers:${p.i}`);
			}
			let groundMax = 0;
			let groundN = 0;
			for (const set of [ people, anglers, cars, pickups, huts, shelters, towers, deer, cattle ]) {
				set.where.forEach((w, k) => {
					if (!w || skip.has(`${set.name}:${k}`)) return;
					groundN++;
					groundMax = Math.max(groundMax, grade(w[0], w[2]));
				});
			}
			const spots = Object.fromEntries(sites.map((s) => [ s.b.r.id, { overlook: s.overlook ?? null, ramp: s.ramp ? [ s.ramp.bed[0][0], s.ramp.bed[0][2] ] : null } ]));
			return { stats, visible, water, spots, groundMax, groundN, fade: [ FADE_NEAR, FADE_FAR ], show: SHOW_WITHIN };
		},
	};
}
