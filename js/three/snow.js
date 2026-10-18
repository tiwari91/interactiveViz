// Snowpack layer: snow draped on the Sierra Nevada, Cascades and Trinity Alps whose snowline
// follows the month's snowpack (% of April 1 average, CDEC snow pillows) in each of CDEC's
// three sections. A big year brings the snowline down and thickens the cover, a dry year leaves
// only the high peaks white; a month with no data shows no snow. The mesh reuses the terrain's
// vertices (same positions), so it sits exactly on the ground.

// CDEC's sections: North = Trinity through Feather and Truckee, Central = Yuba and Tahoe
// through Merced and Walker, South = San Joaquin and Mono through Kern. On the map they are
// split by latitude (blended over a few km), an approximation of those basin groups.
const NORTH_FROM = 39.35;
const SOUTH_TO = 37.55;
const BLEND = 0.18;
// Snowline (metres) at 100% of the April 1 average, per section: higher in the south.
const BASE = [ 1500, 1800, 2150 ];

const smooth = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

// Snowline (m) and cover strength (0..1) for a section at pct (% of April 1 average).
export function snowline(pct, k) {
	if (pct === null || pct === undefined || pct < 0.5) return { line: 9000, alpha: 0 };
	const s = pct / 100;
	const line = s <= 1 ? BASE[k] + 1500 * (1 - s) ** 1.3 : BASE[k] - 450 * Math.min(1, (s - 1) / 1.2);
	return { line, alpha: 0.35 + 0.6 * smooth(0, 0.6, s) };
}

const VERT = `
	attribute float aElev;
	attribute vec3 aRegion;
	attribute float aFlat;
	uniform vec3 uLine;
	uniform vec3 uAlpha;
	varying float vA;
	varying float vLight;
	void main() {
		float line = dot(aRegion, uLine);
		float a = dot(aRegion, uAlpha);
		// Soft edge over 220 m above the snowline; steep faces hold less snow.
		vA = smoothstep(line, line + 220.0, aElev) * a * aFlat;
		vLight = 0.72 + 0.28 * normal.y;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}`;

const FRAG = `
	uniform vec3 uColor;
	uniform float uNight;
	varying float vA;
	varying float vLight;
	void main() {
		if (vA < 0.02) discard;
		vec3 c = uColor * vLight;
		c = mix(c, c * vec3(0.42, 0.48, 0.62), uNight);
		gl_FragColor = vec4(c, vA * 0.92);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

export function createSnow(THREE, grid) {
	const { geom, meta, inCA } = grid;
	const src = geom.attributes.position.array;
	const nrm = geom.attributes.normal.array;
	const n = src.length / 3;
	// Vertices that can ever hold snow: in California, above 1,100 m, north of the Transverse Ranges.
	const keep = new Int32Array(n).fill(-1);
	const elev = [];
	const region = [];
	const flat = [];
	const pos = [];
	const nor = [];
	let m = 0;
	for (let i = 0; i < n; i++) {
		const metres = meta[i * 3];
		const lat = meta[i * 3 + 2];
		if (metres < 1100 || lat < 35.4 || inCA[i] < 0.5) continue;
		keep[i] = m++;
		pos.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
		nor.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
		// A little noise on the elevation so the snowline is ragged, not a contour.
		const wobble = Math.sin(meta[i * 3 + 1] * 61.7) * Math.cos(lat * 53.3) * 70 + Math.sin(meta[i * 3 + 1] * 17.1 + lat * 23.9) * 60;
		elev.push(metres + wobble);
		const north = smooth(NORTH_FROM - BLEND, NORTH_FROM + BLEND, lat);
		const south = 1 - smooth(SOUTH_TO - BLEND, SOUTH_TO + BLEND, lat);
		region.push(north, Math.max(0, 1 - north - south), south);
		flat.push(smooth(0.5, 0.8, nrm[i * 3 + 1]));
	}
	const idx = geom.index.array;
	const index = [];
	for (let t = 0; t < idx.length; t += 3) {
		const a = keep[idx[t]];
		const b = keep[idx[t + 1]];
		const c = keep[idx[t + 2]];
		if (a >= 0 && b >= 0 && c >= 0) index.push(a, b, c);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute("aElev", new THREE.Float32BufferAttribute(elev, 1));
	g.setAttribute("aRegion", new THREE.Float32BufferAttribute(region, 3));
	g.setAttribute("aFlat", new THREE.Float32BufferAttribute(flat, 1));
	g.setIndex(index);
	const uniforms = {
		uLine: { value: new THREE.Vector3(9000, 9000, 9000) },
		uAlpha: { value: new THREE.Vector3(0, 0, 0) },
		uColor: { value: new THREE.Color("#f4f7fa") },
		uNight: { value: 0 },
	};
	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -4,
		polygonOffsetUnits: -4,
	});
	const mesh = new THREE.Mesh(g, mat);
	mesh.renderOrder = 1;
	mesh.frustumCulled = false;

	const cur = { line: [ 9000, 9000, 9000 ], alpha: [ 0, 0, 0 ] };
	let target = { line: [ 9000, 9000, 9000 ], alpha: [ 0, 0, 0 ] };
	const push = () => {
		uniforms.uLine.value.set(...cur.line);
		uniforms.uAlpha.value.set(...cur.alpha);
	};

	return {
		mesh,
		// pcts: [north, central, south] % of April 1 average (null = no data).
		setTarget(pcts) {
			const s = pcts.map((p, k) => snowline(p, k));
			target = { line: s.map((v) => v.line), alpha: s.map((v) => v.alpha) };
		},
		// k: easing step (1 = jump straight to the target).
		update(k) {
			for (let r = 0; r < 3; r++) {
				// A section with no snow fades out without dragging its line to 9,000 m first.
				if (target.alpha[r] === 0) cur.alpha[r] += (0 - cur.alpha[r]) * k;
				else {
					if (cur.alpha[r] < 0.01) cur.line[r] = target.line[r];
					cur.line[r] += (target.line[r] - cur.line[r]) * k;
					cur.alpha[r] += (target.alpha[r] - cur.alpha[r]) * k;
				}
			}
			push();
		},
		setNight(v) {
			uniforms.uNight.value = v;
		},
		// For tests: share of the snow-capable ground drawn as snow (opacity above half) now.
		cover() {
			let on = 0;
			for (let i = 0; i < elev.length; i++) {
				const w = [ region[i * 3], region[i * 3 + 1], region[i * 3 + 2] ];
				const line = w[0] * cur.line[0] + w[1] * cur.line[1] + w[2] * cur.line[2];
				const a = w[0] * cur.alpha[0] + w[1] * cur.alpha[1] + w[2] * cur.alpha[2];
				if (smooth(line, line + 220, elev[i]) * a * flat[i] > 0.5) on++;
			}
			return { share: elev.length ? on / elev.length : 0, lines: [ ...cur.line ], alpha: [ ...cur.alpha ], vertices: elev.length };
		},
		dispose() {
			g.dispose();
			mat.dispose();
		},
	};
}
