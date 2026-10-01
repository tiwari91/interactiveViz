// Water leaving every dam: an animated tailrace from the outlet down the canyon
// (always downhill, flat on the ground), an inflow river into each lake, foaming
// water down spillway chutes when a lake is above ~90% full, mist at the base,
// and small warm lights on the dam at night. Width, speed, foam and mist follow
// the same release value that drives the dam's sound (release.js).
import { createRouter, stripGeometry, placeStrip, KIND } from "./outflowPaths.js";

const RIBBON_VERT = `
	attribute float aSide;
	attribute float aAlong;
	attribute vec4 aMeta; // dam, kind, total length, max half width
	uniform float uRelease[DAMS];
	uniform float uSpill[DAMS];
	varying float vSide;
	varying float vAlong;
	varying float vRel;
	varying float vKind;
	varying float vEnd;
	varying vec3 vWorld;
	void main() {
		int k = int(aMeta.x + 0.5);
		float kind = aMeta.y;
		float rel = kind > 1.5 ? uSpill[k] : uRelease[k];
		// Geometry is rebuilt on the ground for each month's width (see placeStrip).
		vec3 p = position + vec3(0.0, 0.03, 0.0);
		vSide = aSide;
		vAlong = aAlong;
		vRel = rel;
		vKind = kind;
		vEnd = aMeta.z - aAlong;
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
	varying float vKind;
	varying float vEnd;
	varying vec3 vWorld;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	void main() {
		if (vRel < (vKind > 1.5 ? 0.02 : 0.001)) discard;
		float chute = step(1.5, vKind);
		float speed = mix(1.2 + 3.0 * vRel, 6.0, chute);
		vec2 p = vec2(vAlong * 1.6 - uTime * speed, vSide * 1.4);
		float n = noise(p) * 0.55 + noise(p * 2.7 + 3.1) * 0.3 + noise(p * 6.3 - 1.7) * 0.15;
		// White water below the outlet settling into blue; chutes are all white water.
		float churn = vKind < 0.5 ? exp(-vAlong / (1.5 + 3.5 * vRel)) : chute * 0.8;
		float foam = smoothstep(0.62 - 0.35 * churn - 0.15 * vRel, 0.9, n) + churn * 0.55;
		vec3 col = mix(uWater, uFoam, clamp(foam, 0.0, 1.0));
		col += uNight * vec3(0.05, 0.09, 0.13) * (0.6 + foam);
		float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
		float ends = vKind < 0.5 ? smoothstep(0.0, 6.0, vEnd) : vKind < 1.5 ? smoothstep(0.0, 5.0, vAlong) : 1.0;
		float a = edge * (0.9 + 0.1 * foam) * ends * mix(1.0, clamp(vRel * 1.5, 0.0, 1.0), chute);
		float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
		gl_FragColor = vec4(mix(col, uFogColor, fog), a);
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
		gl_PointSize = min(48.0, uPx * (0.6 + 1.4 * m) * (0.5 + t) * 380.0 / -mv.z);
		gl_Position = projectionMatrix * mv;
	}`;

const MIST_FRAG = `
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = dot(c, c) * 4.0;
		if (d > 1.0 || vA < 0.01) discard;
		gl_FragColor = vec4(uColor, (1.0 - d) * (1.0 - d) * vA * 0.3);
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

export function createOutflow(THREE, basins, dams, world, shared, quality) {
	const list = basins.basins;
	const n = list.length;
	const router = createRouter(basins, world);
	const out = { count: 0, side: [], along: [], meta: [], index: [] };
	const strips = [];
	const lengths = new Array(n).fill(0);
	const scales = list.map((b) => Math.max(0.7, Math.min(1.6, dams.info.get(b.r.id).scale)));
	const smooth = (a, b, x) => {
		const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
		return t * t * (3 - 2 * t);
	};
	const ground = (x, z) => router.surface(x, z) + router.OFFSET;

	list.forEach((b, di) => {
		const info = dams.info.get(b.r.id);
		const sc = scales[di];
		// Outflow: from the downstream toe, along the canyon floor, then downhill.
		// Arch dams bulge upstream, so start below the dam line, never in the lake.
		const toe = b.toWorld(Math.min(info.toeU, b.dam.u - 0.6), 0);
		const pts = router.downhill(toe, [ -b.eu[0], -b.eu[1] ], 24 + b.Lu * 2.4, { avoid: b });
		const seq = router.drape(pts);
		if (seq.length > 2) {
			const st = stripGeometry(seq, out, { dam: di, kind: KIND.OUTFLOW });
			// Narrow at the outlet, wide tailrace, then a natural river width.
			const shape = (i, d) => sc * (0.55 + 0.45 * smooth(0, 3, d)) * (1 - 0.5 * smooth(5, 16, d));
			strips.push({ ...st, kind: KIND.OUTFLOW, dam: di, centre: seq, shape, sample: ground });
			lengths[di] = st.length;
		}

		// Inflow: start up the valley above the lake and let the water run down into it.
		const tip = b.toWorld(b.Lu * 1.25, 0);
		const start = [ tip[0] + b.eu[0] * (b.Lu * 1.2 + 6), tip[1] + b.eu[1] * (b.Lu * 1.2 + 6) ];
		const inPts = router.downhill(start, [ -b.eu[0], -b.eu[1] ], b.Lu * 3 + 20, { into: b });
		const inSeq = router.drape(inPts);
		if (inSeq.length > 6) {
			const st = stripGeometry(inSeq, out, { dam: di, kind: KIND.INFLOW });
			const shape = (i) => sc * (0.6 + 0.4 * (i / inSeq.length));
			strips.push({ ...st, kind: KIND.INFLOW, dam: di, centre: inSeq, shape, sample: ground });
		}

		// Spillway chute (embankment dams): white water on the chute floor itself.
		if (info.chute) {
			const st = stripGeometry(info.chute, out, { dam: di, kind: KIND.CHUTE });
			strips.push({ ...st, kind: KIND.CHUTE, dam: di, centre: info.chute, shape: () => info.chuteWidth, sample: (x, z, y) => y });
		}
	});

	const positions = new Float32Array(out.count * 3);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(out.side, 1));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(out.along, 1));
	geom.setAttribute("aMeta", new THREE.Float32BufferAttribute(out.meta, 4));
	geom.setIndex(out.index);
	const release = new Array(n).fill(0);
	const spill = new Array(n).fill(0);
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
			uSpill: { value: spill },
			uWater: { value: new THREE.Color(0x3d8fbf) },
			uFoam: { value: new THREE.Color(0xf2fbff) },
			uNight: night,
		},
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
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

	// Half-width scale per kind for a release value.
	const widthFor = (kind, rel) => (kind === KIND.OUTFLOW ? 0.38 + 0.8 * rel : kind === KIND.INFLOW ? 0.3 + 0.25 * rel : 1);
	function place(outlet) {
		for (const st of strips) {
			const k = widthFor(st.kind, outlet[st.dam]);
			placeStrip(st, st.centre, (i, d) => st.shape(i, d) * k, st.sample, positions);
		}
		geom.attributes.position.needsUpdate = true;
		geom.computeBoundingSphere();
	}
	place(new Array(n).fill(0.5));

	return {
		group,
		lengths,
		// Rebuild the strips on the ground for a month's release (called on month change).
		setWidths(outlet) {
			place(outlet);
		},
		apply(outlet, spillNow) {
			for (let i = 0; i < n; i++) {
				release[i] = outlet[i];
				spill[i] = spillNow[i];
				mist[i] = Math.min(1, outlet[i] * 0.75 + spillNow[i] * 0.9);
			}
		},
		setNight(v) {
			night.value = v;
			lightOn.value = v;
			ribbonMat.uniforms.uWater.value.set(v > 0.5 ? 0x4aa3d8 : 0x3d8fbf);
		},
		state: () => list.map((b, i) => ({
			id: b.r.id,
			width: release[i] > 0.001 && lengths[i] > 0 ? widthFor(KIND.OUTFLOW, release[i]) * scales[i] : 0,
			length: lengths[i],
			mist: mist[i],
			chuteSpill: strips.some((s) => s.dam === i && s.kind === KIND.CHUTE) ? spill[i] : null,
		})),
		// For tests: worst gap between drawn water and the ground, and worst climb along a path.
		verify() {
			let maxGap = 0;
			let maxClimb = 0;
			let worst = null;
			const P = positions;
			const cols = 5;
			for (const st of strips) {
				if (st.kind === KIND.CHUTE) continue;
				for (let r = 0; r < st.rows; r++) {
					for (let c = 0; c < cols; c++) {
						const v = st.start + r * cols + c;
						const pts = [ [ P[v * 3], P[v * 3 + 1], P[v * 3 + 2] ] ];
						if (c < cols - 1) {
							// Midpoint of each cross-section segment, as the GPU draws it.
							const w = v + 1;
							pts.push([ (P[v * 3] + P[w * 3]) / 2, (P[v * 3 + 1] + P[w * 3 + 1]) / 2, (P[v * 3 + 2] + P[w * 3 + 2]) / 2 ]);
						}
						for (const [ x, y, z ] of pts) {
							const gap = Math.abs(y - (router.surface(x, z) + router.OFFSET));
							if (gap > maxGap) {
								maxGap = gap;
								worst = `${list[st.dam].r.id} ${[ "outflow", "inflow" ][st.kind]}`;
							}
						}
					}
				}
				let low = Infinity;
				for (const p of st.centre) {
					maxClimb = Math.max(maxClimb, p[1] - low);
					low = Math.min(low, p[1]);
				}
			}
			return { maxGap: +maxGap.toFixed(3), maxClimb: +Math.max(0, maxClimb).toFixed(3), worst, strips: strips.length };
		},
	};
}
