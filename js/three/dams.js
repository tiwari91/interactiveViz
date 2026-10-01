// Dam models, merged into one vertex-coloured mesh: curved concrete arch and
// gravity walls or trapezoidal earth/rockfill embankments, a crest road, spillway
// (gated crest or abutment chute), a powerhouse, and instanced white-water foam.
import { damTypeOf, isConcrete } from "./damTypes.js";
import { hash2 } from "./world.js";

const SEGMENTS = 28;

function builder(THREE) {
	const pos = [];
	const col = [];
	const c = new THREE.Color();
	const tri = (a, b, d, color) => {
		pos.push(...a, ...b, ...d);
		for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
	};
	const quad = (a, b, d, e, color) => {
		tri(a, b, d, color);
		tri(a, d, e, color);
	};
	return {
		pos,
		col,
		c,
		quad,
		// Axis-aligned-in-plan box given centre, plan axes, size and colours.
		box(center, ax, az, sx, sy, sz, side, top) {
			const [ x, y, z ] = center;
			const p = (i, j, k) => [ x + ax[0] * i * sx / 2 + az[0] * k * sz / 2, y + j * sy, z + ax[1] * i * sx / 2 + az[1] * k * sz / 2 ];
			quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), top);
			quad(p(-1, 0, -1), p(1, 0, -1), p(1, 1, -1), p(-1, 1, -1), side);
			quad(p(1, 0, 1), p(-1, 0, 1), p(-1, 1, 1), p(1, 1, 1), side);
			quad(p(-1, 0, 1), p(-1, 0, -1), p(-1, 1, -1), p(-1, 1, 1), side);
			quad(p(1, 0, -1), p(1, 0, 1), p(1, 1, 1), p(1, 1, -1), side);
		},
	};
}

export function createDams(THREE, data, basins) {
	const B = builder(THREE);
	const C = {
		concrete: new THREE.Color(0xd2cdc2),
		concreteLift: new THREE.Color(0xc2bcb0),
		road: new THREE.Color(0x5d5d5b),
		riprap: new THREE.Color(0x8d8579),
		riprapDark: new THREE.Color(0x6f685f),
		grass: new THREE.Color(0x8a8161),
		rock: new THREE.Color(0x8a857e),
		roof: new THREE.Color(0x4a4d52),
		house: new THREE.Color(0xbdb5a8),
	};
	const foamSpots = [];
	const info = new Map();

	for (const bs of basins.basins) {
		const type = damTypeOf(bs.r);
		const concrete = isConcrete(type);
		const hw = bs.dam.halfWidth;
		const bulge = { arch: 0.38, "gravity-arch": 0.18, gravity: 0.03 }[type] ?? 0.06;
		const crest = bs.dam.crest;
		const seed = bs.r.id.charCodeAt(0) * 31 + bs.r.id.charCodeAt(1);

		const axisAt = (t) => {
			const v = (t * 2 - 1) * hw;
			const u = bs.dam.u + bulge * hw * (1 - (t * 2 - 1) ** 2);
			return [ u, v ];
		};
		const groundAt = (u, v) => {
			let h = Infinity;
			for (const du of [ 0.25, 0, -0.3 ]) {
				const [ x, z ] = bs.toWorld(u + du, v);
				const s = basins.surfaceAt(x, z);
				if (s) h = Math.min(h, s.h);
			}
			return h === Infinity ? crest - 1 : h;
		};
		const bottoms = [];
		for (let i = 0; i <= SEGMENTS; i++) {
			const [ u, v ] = axisAt(i / SEGMENTS);
			bottoms.push(Math.min(crest - 0.15, groundAt(u, v) - 0.25));
		}
		const hMax = crest - Math.min(...bottoms);
		const tc = concrete ? 0.06 * hMax + 0.12 : 0.1 * hMax + 0.18;
		// Section across the wall, upstream -> downstream: [offset along -eu, height fraction].
		const section = (h) => {
			if (type === "arch") return [ [ 0, 0 ], [ 0, 1 ], [ tc, 1 ], [ 0.17 * hMax + 0.15, 0 ] ];
			// Horizontal proportions are scaled down to match the terrain's vertical exaggeration.
			if (concrete) return [ [ -0.03 * h, 0 ], [ 0, 1 ], [ tc, 1 ], [ 0.34 * h + tc, 0 ] ];
			const k = type === "rockfill" ? 0.7 : 0.9;
			return [ [ -k * h - tc, 0 ], [ -tc, 1 ], [ tc, 1 ], [ k * 0.9 * h + tc, 0 ] ];
		};
		const faceColor = (face, y, t) => {
			const n = hash2(Math.round(t * 60) + seed, Math.round(y * 6));
			if (face === 1) return B.c.copy(C.road);
			if (concrete) {
				const lift = Math.abs(Math.sin(y * 4.2)) > 0.93;
				return B.c.copy(lift ? C.concreteLift : C.concrete).multiplyScalar(0.95 + n * 0.08);
			}
			if (type === "rockfill" || face === 0) return B.c.copy(n > 0.5 ? C.riprap : C.riprapDark).multiplyScalar(0.9 + n * 0.2);
			return B.c.copy(C.grass).lerp(C.rock, n * 0.3);
		};

		// Wall surface, face by face, with a few rows so colour noise reads as texture.
		const ROWS = 4;
		const pt = (i, sx, frac) => {
			const t = i / SEGMENTS;
			const [ u, v ] = axisAt(t);
			const y = bottoms[i] + frac * (crest - bottoms[i]);
			const [ x, z ] = bs.toWorld(u - sx, v);
			return [ x, y, z ];
		};
		for (let i = 0; i < SEGMENTS; i++) {
			const s0 = section(crest - bottoms[i]);
			const s1 = section(crest - bottoms[i + 1]);
			for (let f = 0; f < 3; f++) {
				for (let r = 0; r < ROWS; r++) {
					const lerp = (s, k) => [ s[f][0] + (s[f + 1][0] - s[f][0]) * k, s[f][1] + (s[f + 1][1] - s[f][1]) * k ];
					const a0 = lerp(s0, r / ROWS);
					const a1 = lerp(s0, (r + 1) / ROWS);
					const b0 = lerp(s1, r / ROWS);
					const b1 = lerp(s1, (r + 1) / ROWS);
					const p00 = pt(i, a0[0], a0[1]);
					const p01 = pt(i, a1[0], a1[1]);
					const p10 = pt(i + 1, b0[0], b0[1]);
					const p11 = pt(i + 1, b1[0], b1[1]);
					B.quad(p00, p10, p11, p01, faceColor(f, p00[1], i / SEGMENTS));
				}
			}
		}
		// End caps (mostly buried in the abutments).
		for (const i of [ 0, SEGMENTS ]) {
			const s = section(crest - bottoms[i]);
			const ps = s.map(([ sx, fr ]) => pt(i, sx, fr));
			B.quad(ps[0], ps[1], ps[2], ps[3], C.concreteLift);
		}

		const eu = bs.eu;
		const ev = bs.ev;
		const down = [ -eu[0], -eu[1] ];
		const [ mu, mv ] = axisAt(0.5);
		const toe = section(crest - bottoms[SEGMENTS / 2])[3][0];
		const toePoint = (() => {
			const [ x, z ] = bs.toWorld(mu - toe - 0.4, mv);
			return [ x, groundAt(mu - toe - 0.4, mv) + 0.05, z ];
		})();
		const scale = Math.max(0.6, hw / 4);

		// Powerhouse at the toe.
		const [ phx, phz ] = bs.toWorld(mu - toe - 0.55 * scale, mv + hw * 0.25);
		B.box([ phx, groundAt(mu - toe - 0.55 * scale, mv + hw * 0.25) - 0.05, phz ], ev, down, 0.9 * scale, 0.5 * scale, 0.55 * scale, C.house, C.roof);

		let spillTop;
		let spillBottom;
		if (concrete) {
			// Gated crest spillway: piers across the middle of the wall.
			for (let p = 0; p < 6; p++) {
				const t = 0.38 + p * 0.048;
				const [ u, v ] = axisAt(t);
				const [ x, z ] = bs.toWorld(u - tc * 0.5, v);
				B.box([ x, crest, z ], ev, down, 0.14 * scale, 0.2 * scale, tc * 1.05, C.concrete, C.concreteLift);
			}
			const [ u1, v1 ] = axisAt(0.5);
			const [ x1, z1 ] = bs.toWorld(u1 - tc, v1);
			spillTop = [ x1, crest, z1 ];
			spillBottom = toePoint;
		} else {
			// Chute spillway down the right abutment.
			const sv = hw * 1.08 + 0.3;
			const pts = [];
			const len = bs.Lu * 0.85;
			for (let k = 0; k <= 14; k++) {
				const u = bs.dam.u - (len * k) / 14;
				const g = groundAt(u, sv);
				const y = k === 0 ? crest - 0.3 : Math.min(pts[k - 1][1] - 0.02, g + 0.12);
				pts.push([ u, Math.max(y, g + 0.08) ]);
			}
			for (let k = 0; k < 14; k++) {
				const [ ua, ya ] = pts[k];
				const [ ub, yb ] = pts[k + 1];
				const w = 0.28 * scale;
				const P = (u, v, y) => {
					const [ x, z ] = bs.toWorld(u, v);
					return [ x, y, z ];
				};
				B.quad(P(ua, sv - w, ya), P(ua, sv + w, ya), P(ub, sv + w, yb), P(ub, sv - w, yb), C.concrete);
				B.quad(P(ua, sv - w, ya + 0.18), P(ua, sv - w, ya), P(ub, sv - w, yb), P(ub, sv - w, yb + 0.18), C.concreteLift);
				B.quad(P(ua, sv + w, ya), P(ua, sv + w, ya + 0.18), P(ub, sv + w, yb + 0.18), P(ub, sv + w, yb), C.concreteLift);
			}
			const [ x0, z0 ] = bs.toWorld(pts[0][0], sv);
			const [ x1, z1 ] = bs.toWorld(pts[14][0], sv);
			spillTop = [ x0, pts[0][1] + 0.04, z0 ];
			spillBottom = [ x1, pts[14][1] + 0.04, z1 ];
		}

		// Foam: outlet below the dam, and the spillway when the lake is nearly full.
		const [ ox, oz ] = bs.toWorld(mu - toe - 0.4 - 2.2 * scale, mv);
		const outletEnd = [ ox, groundAt(mu - toe - 0.4 - 2.2 * scale, mv) + 0.06, oz ];
		foamSpots.push({ id: bs.r.id, kind: "outlet", a: toePoint, b: outletEnd, width: 0.7 * scale });
		foamSpots.push({ id: bs.r.id, kind: "spill", a: spillTop, b: spillBottom, width: concrete ? 0.18 * hw : 0.5 * scale });
		info.set(bs.r.id, { type, crest, toePoint, center: bs.toWorld(mu, mv), height: hMax });
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
	geom.setAttribute("color", new THREE.Float32BufferAttribute(B.col, 3));
	geom.computeVertexNormals();
	const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide }));
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	const foam = createFoam(THREE, foamSpots);
	return { mesh, foam, info };
}

const FOAM_VERT = `
	attribute float aIntensity;
	varying vec2 vUv;
	varying float vI;
	void main() {
		vUv = uv;
		vI = aIntensity;
		gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
	}`;

const FOAM_FRAG = `
	uniform float uTime;
	uniform vec3 uColor;
	varying vec2 vUv;
	varying float vI;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	void main() {
		if (vI < 0.01) discard;
		vec2 p = vec2(vUv.x * 5.0, vUv.y * 10.0 + uTime * 3.2);
		float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.4;
		float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
		float a = edge * vI * smoothstep(0.35, 0.75, n + vI * 0.25);
		gl_FragColor = vec4(uColor, a * 0.7);
		#include <encodings_fragment>
	}`;

function createFoam(THREE, spots) {
	const geom = new THREE.PlaneGeometry(1, 1);
	geom.rotateX(-Math.PI / 2);
	// uv.y runs along the flow (local -z -> +z after rotation is v from 1 to 0); keep as is.
	geom.setAttribute("aIntensity", new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1));
	const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xf4fbff) } };
	const mat = new THREE.ShaderMaterial({ vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG, uniforms, transparent: true, depthWrite: false });
	const mesh = new THREE.InstancedMesh(geom, mat, spots.length);
	mesh.frustumCulled = false;
	mesh.renderOrder = 3;
	const m = new THREE.Matrix4();
	spots.forEach((s, i) => {
		const a = new THREE.Vector3(...s.a);
		const b = new THREE.Vector3(...s.b);
		const along = b.clone().sub(a);
		const len = Math.max(0.3, along.length());
		along.normalize();
		const side = new THREE.Vector3(along.z, 0, -along.x).normalize();
		const up = new THREE.Vector3().crossVectors(along, side).normalize();
		if (up.y < 0) {
			up.negate();
			side.negate();
		}
		// Local plane: x across (side), z along the flow, y up.
		m.makeBasis(side.multiplyScalar(s.width), up, along.multiplyScalar(len));
		m.setPosition(a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.08, 0)));
		mesh.setMatrixAt(i, m);
	});
	mesh.instanceMatrix.needsUpdate = true;
	return {
		mesh,
		uniforms,
		spots,
		apply(intensities) {
			const arr = geom.attributes.aIntensity.array;
			for (let i = 0; i < spots.length; i++) arr[i] = intensities[i];
			geom.attributes.aIntensity.needsUpdate = true;
		},
	};
}
