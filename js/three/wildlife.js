// Wildlife round each dam, for close views: rafts of waterbirds on the lake, vultures circling
// over the canyon below the dam, deer at the forest edge and cattle on foothill grass.
//
// Everything is modelled in metres and drawn close to true size: the terrain is about a kilometre
// per world unit, so an animal is a pixel or two even at the closest zoom. Nothing is inflated to
// read; instead each model is drawn only while it is at least about 3 px on screen, and the
// exaggeration of any model is capped at CAP_MAX. Everything is instanced and low-poly, and the
// whole layer is skipped beyond a close view, so the state overview never draws it.
import { EXAGGERATION } from "./world.js";
import { regionOf, pelicanLake } from "./regions.js";

// Drawn size over true size, per kind.
export const CAP = { bird: 4, beast: 4 };
export const CAP_MAX = 4;
// On-screen size (CSS px, the model's largest extent) below which a model is not drawn.
export const MIN_PX = [ 2.5, 3.5 ];
const FADE_NEAR = 45;
const FADE_FAR = 85;
// Beyond this distance from every dam (and this height over the ground) nothing is drawn.
const SHOW_WITHIN = 110;
const SHOW_HEIGHT = 90;
// Steepest true grade (rise over run, before the relief exaggeration) an animal may stand on.
export const GENTLE = 0.2;
// The lake surface fades in over its first ~0.3 units of depth (water.js), so the shore a viewer
// sees is about this deep: waterbirds keep to water at least this deep.
const SEEN = 0.13;
const WHITE = 0xffffff;

function rng(seed) {
	let s = Math.abs(Math.floor(seed)) % 2147483646 + 1;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Box-built models in metres (forward +x, up +y, ground or waterline at y = 0), merged into one
// flat-shaded, vertex-coloured geometry and scaled to world units. Pure white parts take each
// instance's colour (a cow's coat); everything else keeps its own colour.
function model(THREE) {
	const parts = [];
	const api = {
		box(w, h, d, x, y, z, color, { rx = 0, rz = 0 } = {}) {
			const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
			g.rotateX(rx);
			g.rotateZ(rz);
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

export function createWildlife(THREE, { basins, dams, outflow, router, world, riparian, shared, quality }) {
	const group = new THREE.Group();
	group.name = "wildlife";
	// The Layers toggle switches this inner group; update() shows or hides the outer one by view.
	const wild = new THREE.Group();
	group.add(wild);
	const unsquash = { value: 1 };
	// World units per CSS pixel at unit distance, from the camera and the canvas height.
	const pxScale = { value: 1 };
	const stats = { sites: 0, waterbirds: 0, raptors: 0, deer: 0, cattle: 0, maxGrade: 0 };
	const off = {
		group, wild, stats, setUnsquash() {}, update() {}, setLevels() {},
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

	// Shaders: the models keep their shape whatever the relief scale (view3d squashes the land
	// group vertically), are drawn only while big enough on screen (and near enough), tint only
	// their white parts per instance, and animate off the shared clock (still under reduced motion).
	const SCREEN = (size) => `(${size.toFixed(5)} * uPxScale / max(1e-4, distance(base, cameraPosition)))`;
	const VIS = (size) => `smoothstep(${MIN_PX[0].toFixed(1)}, ${MIN_PX[1].toFixed(1)}, ${SCREEN(size)}) * (1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, distance(base, cameraPosition)))`;
	const material = (size, anim = "") => {
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });
		mat.onBeforeCompile = (sh) => {
			sh.uniforms.uUnsquash = unsquash;
			sh.uniforms.uTime = shared.uTime;
			sh.uniforms.uPxScale = pxScale;
			sh.vertexShader = sh.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uUnsquash;\nuniform float uTime;\nuniform float uPxScale;\nattribute float aPhase;")
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
	}`);
		};
		// Each set's shader differs (its size, animation): never share a cached program.
		const key = `wildlife:${size}:${anim}`;
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
	function instanced(name, geom, cap, anim = "") {
		const phase = new Float32Array(cap);
		const r = rng(cap * 31 + name.length * 7);
		for (let i = 0; i < cap; i++) phase[i] = r();
		geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
		const bb = geom.boundingBox;
		// The model's largest extent in world units: what the on-screen size test measures.
		const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
		const mesh = new THREE.InstancedMesh(geom, material(size, anim), cap);
		mesh.name = `wildlife-${name}`;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.count = 0;
		mesh.setColorAt(0, col.set(WHITE));
		wild.add(mesh);
		const set = {
			name, mesh, cap, n: 0, where: [], size, metres: geom.userData.metres,
			// Drawn size over true size.
			exaggeration: size / K / geom.userData.metres,
			add(x, y, z, ang, color = WHITE) {
				if (this.n >= cap) return -1;
				const i = this.n++;
				this.put(i, x, y, z, ang);
				mesh.setColorAt(i, col.set(color));
				mesh.count = this.n;
				return i;
			},
			put(i, x, y, z, ang, roll = 0) {
				q.setFromAxisAngle(up, ang);
				if (roll) q.multiply(q2.setFromAxisAngle(v3.set(1, 0, 0), roll));
				m4.compose(v3.set(x, y, z), q, s3.set(1, 1, 1));
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

	const geese = instanced("geese", gooseGeom(THREE, K), 1600, ANIM.drift);
	const ducks = instanced("ducks", duckGeom(THREE, K), 1600, ANIM.drift);
	const pelicans = instanced("pelicans", pelicanGeom(THREE, K), 700, ANIM.drift);
	const raptors = instanced("raptors", raptorGeom(THREE, K), 160, ANIM.flap);
	const deer = instanced("deer", deerGeom(THREE, K), 400, ANIM.graze(DEER_PIVOT, K * CAP.beast));
	const cattle = instanced("cattle", cowGeom(THREE, K), 900, ANIM.graze(COW_PIVOT, K * CAP.beast));

	const COWS = [ 0x1f1b18, 0x1f1b18, 0x5a3424, 0x7a4630, 0x2b2420 ];

	const bedAt = (x, z, id) => {
		const sfc = basins.surfaceAt(x, z);
		return sfc && sfc.zone === "bowl" && sfc.basinId === id ? sfc.h : Infinity;
	};

	const sites = [];
	const r = rng(4242);
	const pick = (arr) => arr[Math.floor(r() * arr.length)];

	for (const { b, d } of damList) {
		const region = regionOf(b.r);
		const site = { b, d, region, center: d.center, soar: [], water: null, lastLevel: null, lastVis: null };
		sites.push(site);
		stats.sites++;
		const down = [ -b.eu[0], -b.eu[1] ];
		const scale = d.scale;
		const id = b.r.id;

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

		// Water slots for rafts of waterbirds: points over the bowl, with the highest bed within a
		// small radius, so a raft there is clear of the shore.
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
			site.water = { slots, rafts };
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

	for (const s of sets) {
		s.mesh.instanceMatrix.needsUpdate = true;
		if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
	}

	// Rafts of waterbirds for a lake level: each on a slot deep enough at that level, apart from
	// the others. Hidden when the lake is.
	const DYN = [ geese, ducks, pelicans ];
	function placeWater(site, L, show) {
		const { water } = site;
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
		for (const raft of water.rafts) {
			const s = show ? take(0.7) : null;
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
	const camPos = new THREE.Vector3();

	return {
		group,
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
			// Birds wheeling over the canyons (near dams only).
			for (const i of near) {
				for (const bird of sites[i].soar) {
					const a = bird.ph + time * bird.w;
					const x = bird.cx + Math.cos(a) * bird.rad;
					const z = bird.cz + Math.sin(a) * bird.rad;
					// Tangent heading, banked into the turn.
					const hx = -Math.sin(a) * Math.sign(bird.w);
					const hz = Math.cos(a) * Math.sign(bird.w);
					raptors.put(bird.i, x, bird.base + bird.lift / vScale, z, face(hx, hz), 0.35 * Math.sign(bird.w));
				}
			}
			raptors.mesh.instanceMatrix.needsUpdate = true;
		},
		// For tests: what is placed, and where the waterbirds are against the water.
		debug() {
			const water = [];
			// Sites in view range (the rest are not drawn and wait for their next close view).
			sites.forEach((site, i) => {
				if (!levels || !near.has(i)) return;
				const L = levels[i];
				const id = site.b.r.id;
				for (const raft of site.water.rafts) {
					for (const bird of raft.birds) {
						const w = raft.set.where[bird.i];
						if (!w) continue;
						water.push({ id, kind: raft.set.name, x: w[0], z: w[2], level: L, y: w[1], bed: bedAt(w[0], w[2], id) });
					}
				}
			});
			// Independent of placement: the true grade under every animal on the ground, wherever
			// it is now.
			let groundMax = 0;
			let groundN = 0;
			for (const set of [ deer, cattle ]) {
				set.where.forEach((w) => {
					if (!w) return;
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
			return { stats, visible, water, groundMax, groundN, drawn, caps, uniforms, metresPerUnit: 1 / K, fade: [ FADE_NEAR, FADE_FAR ], show: SHOW_WITHIN, minPx: MIN_PX };
		},
	};
}
