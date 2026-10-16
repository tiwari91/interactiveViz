// Main-stem rivers of the Central Valley (Sacramento, Feather, American, San Joaquin and its
// big tributaries) from approximate waypoints along their real courses, plus the Delta's main
// channels and the big water-project canals (California Aqueduct and its West and East
// branches, Delta-Mendota Canal) that carry Delta water south to the valley and to the southern
// reservoirs. They are an overview layer: a luminous line whose width grows with camera
// distance so the water system reads from the state view, fading out close up where the
// detailed outflow ribbons take over. Canals are a cooler, thinner, straighter line.

// [lon, lat] waypoints, upstream to downstream.
const RIVERS = {
	Sacramento: [ [ -122.42, 40.70 ], [ -122.39, 40.58 ], [ -122.30, 40.45 ], [ -122.24, 40.18 ], [ -122.12, 40.03 ], [ -121.99, 39.75 ], [ -122.01, 39.40 ], [ -122.01, 39.21 ], [ -121.85, 38.95 ], [ -121.72, 38.80 ], [ -121.60, 38.78 ], [ -121.51, 38.58 ], [ -121.50, 38.46 ], [ -121.58, 38.28 ], [ -121.69, 38.16 ], [ -121.88, 38.04 ], [ -122.05, 38.06 ], [ -122.22, 38.06 ], [ -122.33, 38.03 ] ],
	Feather: [ [ -121.55, 39.51 ], [ -121.68, 39.36 ], [ -121.60, 39.14 ], [ -121.58, 38.90 ], [ -121.60, 38.78 ] ],
	Yuba: [ [ -121.14, 39.38 ], [ -121.30, 39.24 ], [ -121.45, 39.18 ], [ -121.59, 39.13 ] ],
	American: [ [ -121.16, 38.70 ], [ -121.30, 38.59 ], [ -121.42, 38.58 ], [ -121.51, 38.59 ] ],
	"San Joaquin": [ [ -119.71, 37.00 ], [ -119.92, 36.84 ], [ -120.38, 36.75 ], [ -120.46, 36.86 ], [ -120.62, 37.10 ], [ -121.02, 37.31 ], [ -121.27, 37.64 ], [ -121.30, 37.95 ], [ -121.55, 38.03 ], [ -121.80, 38.03 ], [ -121.88, 38.04 ] ],
	Tuolumne: [ [ -120.42, 37.67 ], [ -120.65, 37.63 ], [ -121.00, 37.63 ], [ -121.18, 37.60 ] ],
	Stanislaus: [ [ -120.53, 37.94 ], [ -120.57, 37.82 ], [ -120.93, 37.73 ], [ -121.25, 37.67 ] ],
	Merced: [ [ -120.33, 37.52 ], [ -120.60, 37.40 ], [ -120.95, 37.35 ] ],
};

// Sacramento-San Joaquin Delta channels (approximate courses).
const DELTA = {
	"Old River": [ [ -121.327, 37.808 ], [ -121.45, 37.80 ], [ -121.56, 37.84 ], [ -121.59, 37.92 ], [ -121.57, 38.02 ], [ -121.57, 38.073 ] ],
	"Middle River": [ [ -121.40, 37.83 ], [ -121.47, 37.86 ], [ -121.50, 37.92 ], [ -121.53, 37.98 ], [ -121.56, 38.04 ] ],
	Mokelumne: [ [ -121.43, 38.23 ], [ -121.47, 38.21 ], [ -121.50, 38.17 ], [ -121.53, 38.13 ], [ -121.57, 38.10 ], [ -121.58, 38.06 ] ],
	"Georgiana Slough": [ [ -121.515, 38.236 ], [ -121.53, 38.20 ], [ -121.55, 38.15 ], [ -121.57, 38.12 ] ],
	"Steamboat Slough": [ [ -121.58, 38.29 ], [ -121.60, 38.25 ], [ -121.64, 38.22 ], [ -121.68, 38.18 ] ],
	"Ship Channel": [ [ -121.54, 38.57 ], [ -121.58, 38.45 ], [ -121.60, 38.35 ], [ -121.64, 38.27 ], [ -121.69, 38.17 ] ],
};

// Water-project canals. Facilities from Wikipedia (Clifton Court, Banks, Las Perillas,
// Edmonston, Quail Lake, Silverwood, Perris); the stretches between are approximate.
// "@ID" ends a canal at that reservoir's lake. The aqueduct passes San Luis Reservoir,
// which is not one of the tracked reservoirs, so only the line is drawn there.
const CANALS = {
	"California Aqueduct": [ [ -121.557, 37.83 ], [ -121.621, 37.801 ], [ -121.63, 37.77 ], [ -121.45, 37.55 ], [ -121.25, 37.30 ], [ -121.08, 37.06 ], [ -120.77, 36.90 ], [ -120.45, 36.55 ], [ -119.98, 36.00 ], [ -119.909, 35.843 ], [ -119.70, 35.62 ], [ -119.30, 35.20 ], [ -118.95, 35.00 ], [ -118.825, 34.942 ], [ -118.72, 34.80 ] ],
	"West Branch": [ [ -118.72, 34.80 ], [ -118.746, 34.772 ], [ -118.76, 34.70 ], "@PYM", [ -118.70, 34.58 ], "@CAS" ],
	"East Branch": [ [ -118.72, 34.80 ], [ -118.55, 34.79 ], [ -118.30, 34.70 ], [ -118.04, 34.58 ], [ -117.93, 34.50 ], [ -117.60, 34.40 ], [ -117.33, 34.31 ], [ -117.31, 34.19 ], [ -117.27, 34.05 ], [ -117.22, 33.95 ], "@PRR" ],
	"Delta-Mendota Canal": [ [ -121.585, 37.79 ], [ -121.50, 37.68 ], [ -121.30, 37.50 ], [ -121.10, 37.28 ], [ -121.02, 37.10 ], [ -120.90, 37.00 ], [ -120.55, 36.85 ], [ -120.38, 36.79 ] ],
};

const KIND = { river: 0, delta: 1, canal: 2 };

// World [x, z] points, about one unit apart, along every main-stem river and Delta channel:
// the outflow ribbons below the dams run on until they meet one of these.
export function stemLines(world) {
	return [ ...Object.values(RIVERS), ...Object.values(DELTA) ].map((ll) => {
		const pts = chaikin(chaikin(chaikin(ll.map((p) => world.project(p)))));
		const seq = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const [ ax, az ] = pts[i];
			const [ bx, bz ] = pts[i + 1];
			const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
			for (let k = 0; k < n; k++) seq.push([ ax + (bx - ax) * k / n, az + (bz - az) * k / n ]);
		}
		seq.push(pts[pts.length - 1]);
		return seq;
	});
}

function chaikin(p) {
	const out = [ p[0] ];
	for (let i = 0; i < p.length - 1; i++) {
		const [ ax, az ] = p[i];
		const [ bx, bz ] = p[i + 1];
		out.push([ ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25 ], [ ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75 ]);
	}
	out.push(p[p.length - 1]);
	return out;
}

const VERT = `
	attribute float aSide;
	attribute vec2 aDir;
	attribute float aAlong;
	attribute float aKind;
	attribute float aVis;
	varying float vVis;
	varying float vSide;
	varying float vKind;
	varying float vAlong;
	varying float vNear;
	varying vec3 vWorld;
	void main() {
		vec3 p = position;
		float camD = distance(cameraPosition, (modelMatrix * vec4(p, 1.0)).xyz);
		// Half-width: about 1.5 px on screen at any distance, never thinner than the real channel.
		// Delta channels and canals are drawn thinner than the main rivers.
		float wk = aKind < 0.5 ? 1.0 : aKind < 1.5 ? 0.7 : 0.85;
		p.xz += aDir * aSide * max(0.35 * wk, camD * 0.0016 * wk);
		p.y += 0.15 + camD * 0.004;
		vSide = aSide;
		vKind = aKind;
		vVis = aVis;
		vAlong = aAlong;
		vNear = smoothstep(18.0, 70.0, camD);
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}`;

const FRAG = `
	uniform vec3 uColor;
	uniform vec3 uGlow;
	uniform vec3 uCanal;
	uniform float uTime;
	uniform float uFlow;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	varying float vSide;
	varying float vAlong;
	varying float vNear;
	varying float vKind;
	varying float vVis;
	varying vec3 vWorld;
	void main() {
		float s = abs(vSide);
		float canal = step(1.5, vKind);
		float core = 1.0 - smoothstep(0.35, 1.0, s);
		// A faint shimmer travelling downstream.
		float shimmer = 0.5 + 0.5 * sin(vAlong * 0.35 - uTime * 1.6);
		// Canals: an even, cooler line with a faint glow, no shimmer.
		vec3 col = mix(mix(uColor, uGlow, (1.0 - s) * (0.35 + 0.25 * shimmer)), mix(uCanal, uGlow, (1.0 - s) * 0.3), canal);
		float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
		gl_FragColor = vec4(mix(col, uFogColor, fog * 0.7), core * vNear * vVis * mix(0.55 + 0.4 * uFlow, 0.85, canal));
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

export function createMainRivers(THREE, world, router, shared, basins) {
	const pos = [];
	const side = [];
	const dir = [];
	const along = [];
	const kinds = [];
	const vis = [];
	// Canals fade out over the lakes they run through, so the line reaches the water and stops.
	const lakeFade = (x, z) => {
		let f = 1;
		for (const b of basins.basins) {
			if (Math.abs(x - b.cx) > b.reach || Math.abs(z - b.cz) > b.reach) continue;
			const [ u, v ] = b.toLocal(x, z);
			const t = Math.min(1, Math.max(0, (b.sOf(u, v) - 0.75) / 0.35));
			f = Math.min(f, t);
		}
		return f;
	};
	const index = [];
	const names = [];
	let base = 0;
	const ends = {};
	const courses = [
		...Object.entries(RIVERS).map(([ name, ll ]) => [ name, ll, KIND.river ]),
		...Object.entries(DELTA).map(([ name, ll ]) => [ name, ll, KIND.delta ]),
		...Object.entries(CANALS).map(([ name, ll ]) => [ name, ll, KIND.canal ]),
	];
	for (const [ name, ll, kind ] of courses) {
		const xz = ll.map((p) => {
			if (typeof p !== "string") return world.project(p);
			const b = basins.byId.get(p.slice(1));
			return [ b.cx, b.cz ];
		});
		// Canals keep their engineered, straighter line: one smoothing pass instead of three.
		const pts = kind === KIND.canal ? chaikin(xz) : chaikin(chaikin(chaikin(xz)));
		ends[name] = [ pts[0], pts[pts.length - 1] ];
		// Resample about every unit so the ribbon follows the ground.
		const seq = [];
		for (let i = 0; i < pts.length - 1; i++) {
			const [ ax, az ] = pts[i];
			const [ bx, bz ] = pts[i + 1];
			const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
			for (let k = 0; k < n; k++) seq.push([ ax + (bx - ax) * k / n, az + (bz - az) * k / n ]);
		}
		seq.push(pts[pts.length - 1]);
		let d = 0;
		seq.forEach(([ x, z ], i) => {
			const a = seq[Math.max(0, i - 1)];
			const c = seq[Math.min(seq.length - 1, i + 1)];
			const tl = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
			const sx = -(c[1] - a[1]) / tl;
			const sz = (c[0] - a[0]) / tl;
			if (i) d += Math.hypot(x - seq[i - 1][0], z - seq[i - 1][1]);
			const y = router.surface(x, z);
			const fade = kind === KIND.canal ? lakeFade(x, z) : 1;
			for (const sd of [ -1, 1 ]) {
				pos.push(x, y, z);
				side.push(sd);
				dir.push(sx, sz);
				along.push(d);
				kinds.push(kind);
				vis.push(kind === KIND.canal ? fade : 1);
			}
			if (i) {
				const o = base + (i - 1) * 2;
				index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
			}
		});
		base += seq.length * 2;
		names.push({ name, kind });
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
	geom.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 2));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
	geom.setAttribute("aKind", new THREE.Float32BufferAttribute(kinds, 1));
	geom.setAttribute("aVis", new THREE.Float32BufferAttribute(vis, 1));
	geom.setIndex(index);
	const flow = { value: 0.6 };
	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms: {
			uColor: { value: new THREE.Color(0x2f86c4) },
			uGlow: { value: new THREE.Color(0x9fdcff) },
			uCanal: { value: new THREE.Color(0x1fa5b5) },
			uTime: shared.uTime,
			uFlow: flow,
			uFogColor: shared.uFogColor,
			uFogNear: shared.uFogNear,
			uFogFar: shared.uFogFar,
		},
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: -4,
		polygonOffsetUnits: -4,
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.frustumCulled = false;
	mesh.renderOrder = 3;
	return {
		mesh,
		names: names.filter((n) => n.kind === KIND.river).map((n) => n.name),
		delta: names.filter((n) => n.kind === KIND.delta).map((n) => n.name),
		canals: names.filter((n) => n.kind === KIND.canal).map((n) => n.name),
		// For tests: first and last world [x, z] of each course.
		ends,
		// 0..1 statewide wetness: the lines brighten in wet months.
		setFlow(v) {
			flow.value = v;
		},
		setNight(v) {
			mat.uniforms.uColor.value.set(v > 0.5 ? 0x3f9ad8 : 0x2f86c4);
		},
	};
}
