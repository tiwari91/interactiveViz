// Main-stem rivers of the Central Valley (Sacramento, Feather, American, San Joaquin and its
// big tributaries) from approximate waypoints along their real courses. They are an overview
// layer: a luminous line whose width grows with camera distance so the river system reads
// from the state view, fading out close up where the detailed outflow ribbons take over.

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
	varying float vSide;
	varying float vAlong;
	varying float vNear;
	varying vec3 vWorld;
	void main() {
		vec3 p = position;
		float camD = distance(cameraPosition, (modelMatrix * vec4(p, 1.0)).xyz);
		// Half-width: about 1.5 px on screen at any distance, never thinner than the real channel.
		p.xz += aDir * aSide * max(0.35, camD * 0.0016);
		p.y += 0.15 + camD * 0.004;
		vSide = aSide;
		vAlong = aAlong;
		vNear = smoothstep(70.0, 220.0, camD);
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}`;

const FRAG = `
	uniform vec3 uColor;
	uniform vec3 uGlow;
	uniform float uTime;
	uniform float uFlow;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	varying float vSide;
	varying float vAlong;
	varying float vNear;
	varying vec3 vWorld;
	void main() {
		float s = abs(vSide);
		float core = 1.0 - smoothstep(0.35, 1.0, s);
		// A faint shimmer travelling downstream.
		float shimmer = 0.5 + 0.5 * sin(vAlong * 0.35 - uTime * 1.6);
		vec3 col = mix(uColor, uGlow, (1.0 - s) * (0.35 + 0.25 * shimmer));
		float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
		gl_FragColor = vec4(mix(col, uFogColor, fog * 0.7), core * vNear * (0.55 + 0.4 * uFlow));
		#include <encodings_fragment>
	}`;

export function createMainRivers(THREE, world, router, shared) {
	const pos = [];
	const side = [];
	const dir = [];
	const along = [];
	const index = [];
	const names = [];
	let base = 0;
	for (const [ name, ll ] of Object.entries(RIVERS)) {
		const pts = chaikin(chaikin(chaikin(ll.map((p) => world.project(p)))));
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
			for (const sd of [ -1, 1 ]) {
				pos.push(x, y, z);
				side.push(sd);
				dir.push(sx, sz);
				along.push(d);
			}
			if (i) {
				const o = base + (i - 1) * 2;
				index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
			}
		});
		base += seq.length * 2;
		names.push(name);
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
	geom.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 2));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
	geom.setIndex(index);
	const flow = { value: 0.6 };
	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms: {
			uColor: { value: new THREE.Color(0x2f86c4) },
			uGlow: { value: new THREE.Color(0x9fdcff) },
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
		names,
		// 0..1 statewide wetness: the lines brighten in wet months.
		setFlow(v) {
			flow.value = v;
		},
		setNight(v) {
			mat.uniforms.uColor.value.set(v > 0.5 ? 0x3f9ad8 : 0x2f86c4);
		},
	};
}
