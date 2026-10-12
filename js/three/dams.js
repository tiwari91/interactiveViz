// Dam models, merged into one vertex-coloured mesh: curved concrete arch and
// gravity walls or trapezoidal earth/rockfill embankments, a crest road, spillway
// (gated crest or abutment chute), a powerhouse, and instanced white-water foam.
import { damTypeOf, isConcrete, structureOf } from "./damTypes.js";
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
		concrete: new THREE.Color(0xc9c4ba),
		concreteLift: new THREE.Color(0xb5afa4),
		stain: new THREE.Color(0x8d877d),
		damp: new THREE.Color(0x7c776e),
		parapet: new THREE.Color(0xe2ded6),
		chute: new THREE.Color(0xa29d93),
		road: new THREE.Color(0x5d5d5b),
		riprap: new THREE.Color(0x8d8579),
		riprapDark: new THREE.Color(0x6f685f),
		grass: new THREE.Color(0x76725f),
		rock: new THREE.Color(0x8a857e),
		roof: new THREE.Color(0x4a4d52),
		house: new THREE.Color(0xbdb5a8),
	};
	const foamSpots = [];
	const info = new Map();

	for (const bs of basins.basins) {
		const type = structureOf(damTypeOf(bs.r));
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
		const faceColor = (face, y, t, frac = 0.5) => {
			const n = hash2(Math.round(t * 60) + seed, Math.round(y * 6));
			if (face === 1) return B.c.copy(C.road);
			if (concrete) {
				const lift = Math.abs(Math.sin(y * 4.2)) > 0.93;
				B.c.copy(lift ? C.concreteLift : C.concrete).multiplyScalar(0.96 + n * 0.06);
				if (face === 2) {
					// Weathering: vertical seep stains from the crest and a damp band at the toe.
					const col = Math.round(t * SEGMENTS);
					const stain = hash2(col + seed, 7) > 0.62 ? (0.25 + 0.35 * hash2(col, 3)) * (0.3 + 0.7 * frac) : 0;
					B.c.lerp(C.stain, stain).lerp(C.damp, (1 - Math.min(1, frac * 5)) * 0.55);
				}
				return B.c;
			}
			if (type === "rockfill" || face === 0) return B.c.copy(C.riprap).lerp(C.riprapDark, 0.2 + n * 0.25);
			// Earthfill downstream face: grass with a few horizontal berms.
			const berm = Math.abs(Math.sin(frac * Math.PI * 3)) < 0.12;
			return B.c.copy(C.grass).lerp(C.rock, n * 0.3).multiplyScalar(berm ? 0.82 : 1);
		};

		// Wall surface, face by face, with a few rows so colour noise reads as texture.
		const ROWS = concrete ? 8 : 5;
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
					B.quad(p00, p10, p11, p01, faceColor(f, p00[1], i / SEGMENTS, (a0[1] + a1[1]) / 2));
				}
			}
		}
		// End caps (mostly buried in the abutments).
		for (const i of [ 0, SEGMENTS ]) {
			const s = section(crest - bottoms[i]);
			const ps = s.map(([ sx, fr ]) => pt(i, sx, fr));
			B.quad(ps[0], ps[1], ps[2], ps[3], C.concreteLift);
		}

		// Parapet walls along both edges of the crest road.
		for (let i = 0; i < SEGMENTS; i++) {
			for (const off of [ 0, tc ]) {
				const p0 = pt(i, off, 1);
				const p1 = pt(i + 1, off, 1);
				const ph = 0.09 + 0.02 * hMax / 6;
				const up = (p) => [ p[0], p[1] + ph, p[2] ];
				B.quad(p0, p1, up(p1), up(p0), C.parapet);
			}
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
		let chute = null;
		let chuteWidth = 0;
		let chuteClear = null;
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
			const cw = 0.36 * scale;
			// Highest ground under the chute's whole width, so its floor never dips into the slope.
			const under = (u) => {
				let h = -Infinity;
				for (const dv of [ -cw * 1.1, -cw * 0.5, 0, cw * 0.5, cw * 1.1 ]) {
					for (const du of [ -0.2, 0, 0.2 ]) {
						const [ x, z ] = bs.toWorld(u + du, sv + dv);
						const sfc = basins.surfaceAt(x, z);
						h = Math.max(h, sfc ? sfc.h : groundAt(u, sv));
					}
				}
				return h;
			};
			for (let k = 0; k <= 14; k++) {
				const u = bs.dam.u - (len * k) / 14;
				const g = under(u);
				const y = k === 0 ? crest - 0.3 : Math.min(pts[k - 1][1] - 0.02, g + 0.12);
				pts.push([ u, Math.max(y, g + 0.08) ]);
			}
			for (let k = 0; k < 14; k++) {
				const [ ua, ya ] = pts[k];
				const [ ub, yb ] = pts[k + 1];
				const w = cw;
				const P = (u, v, y) => {
					const [ x, z ] = bs.toWorld(u, v);
					return [ x, y, z ];
				};
				B.quad(P(ua, sv - w, ya), P(ua, sv + w, ya), P(ub, sv + w, yb), P(ub, sv - w, yb), B.c.copy(C.chute).multiplyScalar(0.94 + 0.08 * hash2(k, seed)));
				B.quad(P(ua, sv - w, ya + 0.18), P(ua, sv - w, ya), P(ub, sv - w, yb), P(ub, sv - w, yb + 0.18), C.concreteLift);
				B.quad(P(ua, sv + w, ya), P(ua, sv + w, ya + 0.18), P(ub, sv + w, yb + 0.18), P(ub, sv + w, yb), C.concreteLift);
			}
			const [ x0, z0 ] = bs.toWorld(pts[0][0], sv);
			const [ x1, z1 ] = bs.toWorld(pts[14][0], sv);
			spillTop = [ x0, pts[0][1] + 0.04, z0 ];
			spillBottom = [ x1, pts[14][1] + 0.04, z1 ];
			chute = pts.map(([ u, y ]) => {
				const [ x, z ] = bs.toWorld(u, sv);
				return [ x, y + 0.05, z ];
			});
			chuteWidth = 0.34 * scale;
			chuteClear = Math.min(...pts.map(([ u, y ]) => y - under(u)));
			// Headworks: a gated control structure across the top of the chute.
			const [ hx, hz ] = bs.toWorld(pts[0][0] + 0.15, sv);
			B.box([ hx, pts[0][1] - 0.1, hz ], ev, down, 0.36 * scale * 2.4, 0.42, 0.35, C.concreteLift, C.road);
			for (let g = -2; g <= 2; g++) {
				const [ gx, gz ] = bs.toWorld(pts[0][0] + 0.15, sv + g * 0.17 * scale);
				B.box([ gx, pts[0][1] + 0.3, gz ], ev, down, 0.07, 0.25, 0.4, C.concrete, C.parapet);
			}
			// Stilling basin at the foot.
			const [ bx, bz ] = bs.toWorld(pts[14][0] - 0.3, sv);
			B.box([ bx, pts[14][1] - 0.05, bz ], ev, down, 0.36 * scale * 3, 0.16, 0.9, C.concreteLift, C.chute);
		}

		// Foam: outlet below the dam, and the spillway when the lake is nearly full.
		const [ ox, oz ] = bs.toWorld(mu - toe - 0.4 - 2.2 * scale, mv);
		const outletEnd = [ ox, groundAt(mu - toe - 0.4 - 2.2 * scale, mv) + 0.06, oz ];
		// Spill sheet only on a concrete dam's own face; chutes get a ribbon in outflow.js.
		if (concrete) foamSpots.push({ id: bs.r.id, kind: "spill", a: spillTop, b: spillBottom, width: 0.18 * hw });
		void outletEnd;
		info.set(bs.r.id, {
			type, crest, toePoint, center: bs.toWorld(mu, mv), height: hMax, scale, concrete,
			toeU: mu - toe - 0.4, spillTop, spillBottom, halfWidth: hw, groundAt, chute, chuteWidth, chuteClear,
			lights: [ axisAt(0.02), axisAt(0.98) ].map(([ u, v ]) => {
				const [ x, z ] = bs.toWorld(u - tc * 0.5, v);
				return [ x, crest + 0.25, z ];
			}).concat([ [ phx, groundAt(mu - toe - 0.55 * scale, mv + hw * 0.25) + 0.55 * scale, phz ] ]),
		});
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
	geom.setAttribute("color", new THREE.Float32BufferAttribute(B.col, 3));
	geom.computeVertexNormals();
	const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
	// Concrete texture in world space: formwork lifts and joints, mottling, speckle and
	// rain streaks. Applied only to the light, unsaturated (concrete) surfaces.
	mat.onBeforeCompile = (sh) => {
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vDamW;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvDamW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
		sh.fragmentShader = sh.fragmentShader
			.replace("#include <common>", `#include <common>
varying vec3 vDamW;
float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dn(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y);
}`)
			.replace("#include <color_fragment>", `#include <color_fragment>
{
	vec3 c = diffuseColor.rgb;
	float lum = dot(c, vec3(0.3, 0.59, 0.11));
	float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
	float concrete = step(0.22, lum) * step(sat, 0.08);
	float along = vDamW.x + vDamW.z;
	float lift = smoothstep(0.46, 0.5, abs(fract(vDamW.y * 2.2) - 0.5));
	float joint = smoothstep(0.485, 0.5, abs(fract(along * 0.55) - 0.5));
	float blotch = dn(vec2(along * 1.1, vDamW.y * 0.9)) * 0.6 + dn(vec2(along * 3.3, vDamW.y * 2.7)) * 0.4;
	float speck = dh(floor(vec2(along * 40.0, vDamW.y * 40.0)));
	float streak = smoothstep(0.55, 0.92, dn(vec2(along * 7.0, vDamW.y * 0.35)));
	float k = (0.9 + 0.16 * blotch) * (0.97 + 0.05 * speck) * (1.0 - 0.16 * lift - 0.12 * joint) * (1.0 - 0.14 * streak);
	diffuseColor.rgb = c * mix(1.0, k, concrete);
}`);
	};
	const mesh = new THREE.Mesh(geom, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	const foam = createFoam(THREE, foamSpots);
	return { mesh, foam, info };
}

const FOAM_VERT = `
	attribute float aIntensity;
	attribute float aKind;
	varying vec2 vUv;
	varying float vI;
	varying float vKind;
	void main() {
		vUv = uv;
		vI = aIntensity;
		vKind = aKind;
		gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
	}`;

const FOAM_FRAG = `
	uniform float uTime;
	uniform vec3 uColor;
	uniform float uNight;
	varying vec2 vUv;
	varying float vI;
	varying float vKind;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	void main() {
		if (vI < 0.01) discard;
		// Spill sheets stream fast in fine vertical threads; the tailrace churns.
		float speed = vKind > 0.5 ? 7.0 : 3.2;
		vec2 p = vKind > 0.5 ? vec2(vUv.x * 14.0, vUv.y * 6.0 + uTime * speed) : vec2(vUv.x * 5.0, vUv.y * 10.0 + uTime * speed);
		float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.4;
		float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
		float body = vKind > 0.5 ? 0.55 : 0.3;
		float a = edge * vI * (body + (1.0 - body) * smoothstep(0.3, 0.7, n));
		vec3 col = mix(vec3(0.62, 0.8, 0.9), uColor, smoothstep(0.35, 0.8, n));
		col += uNight * vec3(0.06, 0.09, 0.12);
		gl_FragColor = vec4(col, min(1.0, a * 1.15));
		#include <encodings_fragment>
	}`;

function createFoam(THREE, spots) {
	const geom = new THREE.PlaneGeometry(1, 1);
	geom.rotateX(-Math.PI / 2);
	// uv.y runs along the flow (local -z -> +z after rotation is v from 1 to 0); keep as is.
	geom.setAttribute("aIntensity", new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1));
	geom.setAttribute("aKind", new THREE.InstancedBufferAttribute(new Float32Array(spots.map((s) => (s.kind === "spill" ? 1 : 0))), 1));
	const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xf4fbff) }, uNight: { value: 0 } };
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
