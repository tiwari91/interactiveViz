// Water leaving every dam: an animated tailrace ribbon from the outlet down the
// canyon into the river, mist rising at the base, and small warm lights on the
// dam at night. Width, speed, foam and mist all follow the same release value
// that drives the dam's sound (release.js).
const RIBBON_VERT = `
	attribute float aSide;
	attribute float aAlong;
	attribute float aDam;
	attribute vec3 aDir;
	uniform float uRelease[DAMS];
	uniform float uScale[DAMS];
	varying float vSide;
	varying float vAlong;
	varying float vRel;
	varying vec3 vWorld;
	void main() {
		int k = int(aDam + 0.5);
		float rel = uRelease[k];
		float far = clamp(distance(cameraPosition, position) / 260.0, 1.0, 3.0);
		// Starts narrow at the outlet, spreads into the channel.
		float spread = mix(0.55, 1.0, smoothstep(0.0, 3.0, aAlong)) * mix(1.0, 0.5, smoothstep(5.0, 16.0, aAlong));
		float w = (0.38 + 0.8 * rel) * uScale[k] * spread * far * step(0.001, rel);
		vec3 side = normalize(vec3(-aDir.z, 0.0, aDir.x));
		vec3 p = position + side * aSide * w;
		vSide = aSide;
		vAlong = aAlong;
		vRel = rel;
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}`;

const RIBBON_FRAG = `
	uniform float uTime;
	uniform vec3 uWater;
	uniform vec3 uFoam;
	uniform float uNight;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	varying float vSide;
	varying float vAlong;
	varying float vRel;
	varying vec3 vWorld;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	void main() {
		if (vRel < 0.001) discard;
		float speed = 1.2 + 3.0 * vRel;
		vec2 p = vec2(vAlong * 1.6 - uTime * speed, vSide * 1.4);
		float n = noise(p) * 0.55 + noise(p * 2.7 + 3.1) * 0.3 + noise(p * 6.3 - 1.7) * 0.15;
		// White water right below the outlet, settling into blue downstream.
		float churn = exp(-vAlong / (1.5 + 3.5 * vRel));
		float foam = smoothstep(0.62 - 0.35 * churn - 0.15 * vRel, 0.9, n) + churn * 0.55;
		vec3 col = mix(uWater, uFoam, clamp(foam, 0.0, 1.0));
		col += uNight * vec3(0.05, 0.09, 0.13) * (0.6 + foam);
		float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
		float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
		gl_FragColor = vec4(mix(col, uFogColor, fog), edge * (0.9 + 0.1 * foam));
		#include <encodings_fragment>
	}`;

const MIST_VERT = `
	attribute vec3 aBase;
	attribute float aDam;
	attribute vec3 aSeed;
	uniform float uTime;
	uniform float uMist[DAMS];
	uniform float uPx;
	varying float vA;
	void main() {
		int k = int(aDam + 0.5);
		float m = uMist[k];
		float t = fract(uTime * (0.18 + 0.12 * aSeed.z) + aSeed.x);
		vec3 p = aBase + vec3((aSeed.y - 0.5) * 2.0 * (0.4 + t), t * (0.8 + 2.2 * m), (aSeed.z - 0.5) * 2.0 * (0.4 + t));
		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		vA = (0.25 + 0.75 * m) * sin(3.14159 * t) * step(0.02, m);
		gl_PointSize = min(90.0, uPx * (0.8 + 2.0 * m) * (0.6 + t) * 700.0 / -mv.z);
		gl_Position = projectionMatrix * mv;
	}`;

const MIST_FRAG = `
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = dot(c, c) * 4.0;
		if (d > 1.0 || vA < 0.01) discard;
		gl_FragColor = vec4(uColor, (1.0 - d) * (1.0 - d) * vA * 0.42);
		#include <encodings_fragment>
	}`;

const LIGHT_VERT = `
	attribute float aSeed;
	uniform float uTime;
	uniform float uOn;
	uniform float uPx;
	varying float vA;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vA = uOn * (0.8 + 0.2 * sin(uTime * 2.0 + aSeed * 40.0));
		gl_PointSize = uPx * clamp(260.0 / -mv.z, 2.0, 9.0);
		gl_Position = projectionMatrix * mv;
	}`;

const LIGHT_FRAG = `
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = length(c) * 2.0;
		if (d > 1.0 || vA < 0.01) discard;
		float core = smoothstep(1.0, 0.0, d);
		gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * (0.6 + core), core * core * vA);
		#include <encodings_fragment>
	}`;

export function createOutflow(THREE, basins, dams, rivers, world, shared, quality) {
	const list = basins.basins;
	const n = list.length;
	const pos = [];
	const side = [];
	const along = [];
	const dam = [];
	const dir = [];
	const index = [];
	const lengths = [];
	let base = 0;

	const surface = (x, z) => {
		const s = basins.surfaceAt(x, z);
		return Math.max(0.3, s ? s.h : world.groundY(x, z));
	};

	list.forEach((b, di) => {
		const info = dams.info.get(b.r.id);
		// Path: outlet -> down the canyon centre -> into the nearest river end, if close.
		const pts = [];
		const step = 0.45;
		const canyonLen = Math.max(3, b.Lu * 0.6);
		for (let d = 0; d <= canyonLen; d += step) {
			const [ x, z ] = b.toWorld(info.toeU - d, 0);
			pts.push([ x, z ]);
		}
		// Then follow the ground downhill (lowest neighbour within ±70° of the heading),
		// joining a river end if one is close.
		let [ hx, hz ] = [ -b.eu[0], -b.eu[1] ];
		const [ d0x, d0z ] = [ hx, hz ];
		const [ damX, damZ ] = b.damPoint;
		// Only join river ends further downstream than the canyon, never loop back.
		const ends = (rivers.ends.get(b.r.id) ?? []).filter((e) => Math.hypot(e[0] - damX, e[2] - damZ) > canyonLen + 2);
		const maxLen = 10 + b.Lu * 1.6;
		for (let walked = 0; walked < maxLen; walked += step) {
			const [ px, pz ] = pts[pts.length - 1];
			const near = ends.find((e) => Math.hypot(e[0] - px, e[2] - pz) < 2.5);
			if (near) {
				pts.push([ near[0], near[2] ]);
				break;
			}
			let best = null;
			for (let a = -1.2; a <= 1.2; a += 0.3) {
				const dx = hx * Math.cos(a) - hz * Math.sin(a);
				const dz = hx * Math.sin(a) + hz * Math.cos(a);
				const g = surface(px + dx * step * 2, pz + dz * step * 2) + Math.abs(a) * 0.04;
				if (!best || g < best.g) best = { g, dx, dz };
			}
			hx = hx * 0.6 + best.dx * 0.4;
			hz = hz * 0.6 + best.dz * 0.4;
			// Keep heading broadly downstream of the dam (within ~75 degrees).
			if (hx * d0x + hz * d0z < 0.26) {
				hx = hx * 0.5 + d0x * 0.5;
				hz = hz * 0.5 + d0z * 0.5;
			}
			const l = Math.hypot(hx, hz);
			hx /= l;
			hz /= l;
			pts.push([ px + hx * step, pz + hz * step ]);
		}
		// Heights: draped, never climbing (water runs downhill), lifted clear of the ground.
		const seq = pts.map(([ x, z ], i) => {
			const g = surface(x, z);
			return [ x, Math.max(g + 0.22, i === 0 ? info.toePoint[1] + 0.12 : -Infinity), z ];
		});
		// Smooth the height profile so the ribbon glides over the coarse terrain.
		for (let pass = 0; pass < 2; pass++) {
			for (let i = 1; i < seq.length - 1; i++) {
				const g = surface(seq[i][0], seq[i][2]) + 0.18;
				seq[i][1] = Math.max(g, (seq[i - 1][1] + seq[i][1] * 2 + seq[i + 1][1]) / 4);
			}
		}
		let dist = 0;
		seq.forEach((p, i) => {
			const a = seq[Math.max(0, i - 1)];
			const c = seq[Math.min(seq.length - 1, i + 1)];
			const dx = c[0] - a[0];
			const dz = c[2] - a[2];
			const len = Math.hypot(dx, dz) || 1;
			if (i > 0) dist += Math.hypot(p[0] - a[0], p[2] - a[2]);
			for (const s of [ -1, 1 ]) {
				pos.push(...p);
				side.push(s);
				along.push(dist);
				dam.push(di);
				dir.push(dx / len, 0, dz / len);
			}
			if (i > 0) {
				const o = base + (i - 1) * 2;
				index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
			}
		});
		base += seq.length * 2;
		lengths.push(dist);
	});

	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
	geom.setAttribute("aDam", new THREE.Float32BufferAttribute(dam, 1));
	geom.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 3));
	geom.setIndex(index);
	const release = new Array(n).fill(0);
	const scales = list.map((b) => Math.max(0.7, Math.min(1.6, dams.info.get(b.r.id).scale)));
	const night = { value: 0 };
	const ribbonMat = new THREE.ShaderMaterial({
		vertexShader: RIBBON_VERT.replace(/DAMS/g, String(n)),
		fragmentShader: RIBBON_FRAG,
		uniforms: {
			uTime: shared.uTime,
			uFogColor: shared.uFogColor,
			uFogNear: shared.uFogNear,
			uFogFar: shared.uFogFar,
			uRelease: { value: release },
			uScale: { value: scales },
			uWater: { value: new THREE.Color(0x3d8fbf) },
			uFoam: { value: new THREE.Color(0xf2fbff) },
			uNight: night,
		},
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -6,
		polygonOffsetUnits: -6,
	});
	const ribbon = new THREE.Mesh(geom, ribbonMat);
	ribbon.renderOrder = 4;
	ribbon.frustumCulled = false;

	// Mist at each outlet (and spillway foot).
	const perDam = quality === "high" ? 26 : 10;
	const mBase = [];
	const mDam = [];
	const mSeed = [];
	list.forEach((b, di) => {
		const info = dams.info.get(b.r.id);
		for (let k = 0; k < perDam; k++) {
			const at = k % 3 === 2 && info.spillBottom ? info.spillBottom : info.toePoint;
			mBase.push(at[0], at[1] + 0.2, at[2]);
			mDam.push(di);
			mSeed.push(Math.random(), Math.random(), Math.random());
		}
	});
	const mGeom = new THREE.BufferGeometry();
	mGeom.setAttribute("position", new THREE.Float32BufferAttribute(mBase, 3));
	mGeom.setAttribute("aBase", new THREE.Float32BufferAttribute(mBase, 3));
	mGeom.setAttribute("aDam", new THREE.Float32BufferAttribute(mDam, 1));
	mGeom.setAttribute("aSeed", new THREE.Float32BufferAttribute(mSeed, 3));
	const mist = new Array(n).fill(0);
	const px = { value: Math.min(window.devicePixelRatio || 1, 2) };
	const mistMat = new THREE.ShaderMaterial({
		vertexShader: MIST_VERT.replace(/DAMS/g, String(n)),
		fragmentShader: MIST_FRAG,
		uniforms: { uTime: shared.uTime, uMist: { value: mist }, uColor: { value: new THREE.Color(0xf4fbff) }, uPx: px },
		transparent: true,
		depthWrite: false,
	});
	const mistPoints = new THREE.Points(mGeom, mistMat);
	mistPoints.frustumCulled = false;
	mistPoints.renderOrder = 5;

	// Warm lights on crests and powerhouses, visible at night.
	const lPos = [];
	const lSeed = [];
	list.forEach((b) => {
		for (const p of dams.info.get(b.r.id).lights) {
			lPos.push(...p);
			lSeed.push(Math.random());
		}
	});
	const lGeom = new THREE.BufferGeometry();
	lGeom.setAttribute("position", new THREE.Float32BufferAttribute(lPos, 3));
	lGeom.setAttribute("aSeed", new THREE.Float32BufferAttribute(lSeed, 1));
	const lightOn = { value: 0 };
	const lights = new THREE.Points(lGeom, new THREE.ShaderMaterial({
		vertexShader: LIGHT_VERT,
		fragmentShader: LIGHT_FRAG,
		uniforms: { uTime: shared.uTime, uOn: lightOn, uPx: px },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	}));
	lights.frustumCulled = false;
	lights.renderOrder = 6;

	const group = new THREE.Group();
	group.add(ribbon, mistPoints, lights);

	return {
		group,
		lengths,
		// outlet[i], spill[i]: 0..1 release values (same as the dam's sound).
		apply(outlet, spill) {
			for (let i = 0; i < n; i++) {
				release[i] = outlet[i];
				mist[i] = Math.min(1, outlet[i] * 0.75 + spill[i] * 0.9);
			}
		},
		setNight(v) {
			night.value = v;
			lightOn.value = v;
			ribbonMat.uniforms.uWater.value.set(v > 0.5 ? 0x4aa3d8 : 0x3d8fbf);
		},
		state: () => list.map((b, i) => ({ id: b.r.id, width: release[i] > 0.001 ? (0.38 + 0.8 * release[i]) * scales[i] : 0, length: lengths[i], mist: mist[i] })),
	};
}
