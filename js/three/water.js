// Water surfaces: one instanced mesh for every reservoir lake and a large ocean
// plane. Shared shader: layered ripples, Fresnel sky reflection, sun glint,
// depth tint, and a faint pull toward each reservoir's "% full" colour.
import { SEA_Y } from "./world.js";

const VERT = `
	varying vec3 vWorld;
	varying vec3 vTint;
	varying float vHi;
	varying vec2 vUv;
	varying float vYl;
	#ifdef USE_INSTANCING
		attribute float aHighlight;
		attribute float aRow;
		attribute float aFull;
		attribute vec2 aArch;
	#endif
	varying vec2 vArch;
	varying float vRow;
	varying float vFull;
	void main() {
		vUv = uv;
		vec4 p = vec4(position, 1.0);
		#ifdef USE_INSTANCING
			p = instanceMatrix * p;
			vHi = aHighlight;
			vRow = aRow;
			vFull = aFull;
			vArch = aArch;
		#else
			vArch = vec2(0.0, 1.0);
			vHi = 0.0;
			vRow = -1.0;
			vFull = 0.0;
		#endif
		#ifdef USE_INSTANCING_COLOR
			vTint = instanceColor;
		#else
			vTint = vec3(0.0);
		#endif
		vec4 w = modelMatrix * p;
		vWorld = w.xyz;
		vYl = p.y; // height before the land's zoom-dependent vertical scale
		gl_Position = projectionMatrix * viewMatrix * w;
	}`;

const FRAG = `
	uniform float uTime;
	uniform float uScale;
	uniform float uTintMix;
	uniform float uAlpha;
	uniform vec3 uSunDir;
	uniform vec3 uSunColor;
	uniform vec3 uSkyTop;
	uniform vec3 uSkyHorizon;
	uniform vec3 uDeep;
	uniform vec3 uShallow;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	uniform float uClip;
	uniform float uLift;
	uniform vec3 uMoonDir;
	uniform sampler2D uBed;
	uniform float uRows;
	uniform float uBedScale;
	varying vec2 vArch;
	uniform vec3 uSand;
	uniform vec3 uFoamCol;
	varying float vRow;
	varying float vFull;
	varying vec3 vWorld;
	varying vec3 vTint;
	varying float vHi;
	varying vec2 vUv;
	varying float vYl;
	float gDist;

	// Each wave fades out with distance before it can alias into moire.
	vec3 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
		float ph = dot(p, dir) * freq + uTime * speed;
		float lod = 1.0 / (1.0 + gDist * freq * uScale * 0.02);
		return vec3(dir * cos(ph) * freq * amp, sin(ph) * amp) * lod;
	}

	void main() {
		if (uClip > 0.5) {
			// Keep lake water inside its basin outline (plane spans u -0.82..1.45, v -1.45..1.45).
			float un = mix(-0.82, 1.45, vUv.x);
			float vn = (vUv.y - 0.5) * 2.9;
			if (length(vec2(un, vn)) > 1.32) discard;
			// Never below the dam: an arch wall bows upstream, and the lake ends at its face.
			float ta = (vUv.y - 0.5) / vArch.y;
			if (vUv.x < vArch.x * max(0.0, 1.0 - ta * ta)) discard;
		}
		// Water depth from the lake's bed map (depth below full pool): soft shoreline and
		// shallow-to-deep colour.
		float depth = 6.0;
		if (vRow >= 0.0) {
			float below = texture2D(uBed, vec2(vUv.x, (vRow + vUv.y) / uRows)).r * uBedScale;
			depth = vYl - (vFull - below);
			if (depth < 0.0) discard;
		}
		gDist = length(cameraPosition - vWorld);
		vec2 p = vWorld.xz * uScale;
		vec3 g = wave(p, normalize(vec2(0.8, 0.6)), 1.9, 1.3, 0.032)
			+ wave(p, normalize(vec2(0.35, -0.94)), 2.4, 1.1, 0.026)
			+ wave(p, normalize(vec2(-0.5, 0.9)), 3.1, 1.9, 0.03)
			+ wave(p, normalize(vec2(0.97, -0.25)), 4.3, 2.2, 0.018)
			+ wave(p, normalize(vec2(0.2, -1.0)), 5.7, 2.6, 0.016)
			+ wave(p, normalize(vec2(-0.9, -0.3)), 9.3, 3.4, 0.009);
		vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
		vec3 V = normalize(cameraPosition - vWorld);
		float ndv = max(dot(n, V), 0.0);
		float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
		vec3 R = reflect(-V, n);
		vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.4, 0.0, 1.0));
		// Shallows show the bed through clearer, lighter water; deep water is dark.
		float deepness = vRow >= 0.0 ? smoothstep(0.08, 1.3, depth) : 0.6;
		vec3 shallowCol = mix(uShallow * 1.25, uSand * (1.0 - 0.75 * uLift), 0.3 * (1.0 - smoothstep(0.0, 0.8, depth)));
		vec3 body = mix(shallowCol, uDeep * mix(0.85, 0.6, uLift), deepness) * (0.92 + 0.16 * g.z / 0.1);
		body = mix(body, vTint, uTintMix);
		// Night: the water body goes dark and the surface is mostly reflection.
		body *= 1.0 - 0.6 * uLift;
		vec3 col = mix(body, sky, fres * mix(0.75, 0.95, uLift));
		// A thin lapping line right at the water's edge.
		float lap = vRow >= 0.0 ? smoothstep(0.0, 0.05, depth) * (1.0 - smoothstep(0.06, 0.22, depth)) : 0.0;
		col = mix(col, uFoamCol * (1.0 - 0.8 * uLift), lap * (0.1 + 0.06 * sin(uTime * 1.3 + vWorld.x * 0.7 + vWorld.z * 0.5)));
		float spec = pow(max(dot(R, uSunDir), 0.0), 260.0);
		// The sun's glint; at night the moon's is much fainter.
		col += uSunColor * spec * 2.4 * (1.0 - 0.85 * uLift);
		col += vec3(0.9, 0.95, 1.0) * vHi * mix(0.05, 0.012, uLift);
		// Night: moonlit sheen so water still reads against dark land.
		// Moonlight: a broad soft sheen on the water as well as the sharp glint.
		// Moon path: the moon sits low ahead of the viewer, so its reflection runs as a broken,
		// vertically stretched band of glints across the water toward the camera.
		if (uLift > 0.0 && vRow >= 0.0) {
			vec3 Rn = normalize(R);
			float az = dot(normalize(Rn.xz + vec2(1e-5)), normalize(uMoonDir.xz));
			float del = Rn.y - uMoonDir.y;
			// The ripples tilt R, which breaks the path into glints on its own.
			float path = smoothstep(0.9975, 0.99985, az) * exp(-del * del * 70.0);
			float disc = pow(max(dot(Rn, uMoonDir), 0.0), 600.0);
			col += uLift * uSunColor * (path * 0.12 * (1.0 - ndv) * (1.0 - ndv) + disc * 0.3);
		}
		float fog = smoothstep(uFogNear, uFogFar, gDist);
		float edgeA = vRow >= 0.0 ? smoothstep(0.0, 0.3, depth) : 1.0;
		gl_FragColor = vec4(mix(col, uFogColor, fog), uAlpha * edgeA);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

export function waterUniforms(THREE) {
	return {
		uTime: { value: 0 },
		uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
		uSunColor: { value: new THREE.Color(0xfff2d8) },
		uSkyTop: { value: new THREE.Color(0x5b8fd0) },
		uSkyHorizon: { value: new THREE.Color(0xcfe0ee) },
		uFogColor: { value: new THREE.Color(0xcfe0ee) },
		uFogNear: { value: 900 },
		uFogFar: { value: 2600 },
		uLift: { value: 0 },
		uMoonDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
	};
}

function makeMaterial(THREE, shared, own) {
	return new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms: { ...shared, ...own },
		transparent: own.uAlpha.value < 1,
	});
}

// Depth below the full pool for every lake, sampled over its water plane, packed one lake
// per band of rows into a byte texture (linear filtering works everywhere).
const BED_W = 64;
const BED_H = 48;
function bedAtlas(THREE, basins) {
	const list = basins.basins;
	const below = new Float32Array(BED_W * BED_H * list.length);
	let scale = 0.5;
	list.forEach((b, k) => {
		for (let j = 0; j < BED_H; j++) {
			for (let i = 0; i < BED_W; i++) {
				// Same mapping as the plane: uv.x along u from u0 to 1.45 Lu, uv.y across v.
				const u = b.u0 + (b.Lu * 1.45 - b.u0) * (i + 0.5) / BED_W;
				const v = (0.5 - (j + 0.5) / BED_H) * 2.9 * b.Lv;
				const [ x, z ] = b.toWorld(u, v);
				const sfc = basins.surfaceAt(x, z);
				const d = Math.max(0, b.P - (sfc ? sfc.h : b.P + 1));
				below[(k * BED_H + j) * BED_W + i] = d;
				scale = Math.max(scale, d);
			}
		}
	});
	const bytes = new Uint8Array(below.length * 4);
	below.forEach((d, n) => {
		bytes[n * 4] = Math.round(d / scale * 255);
		bytes[n * 4 + 3] = 255;
	});
	const tex = new THREE.DataTexture(bytes, BED_W, BED_H * list.length, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return { tex, scale };
}

export function createLakes(THREE, basins, shared) {
	const list = basins.basins;
	const geom = new THREE.PlaneGeometry(1, 1);
	geom.rotateX(-Math.PI / 2);
	geom.setAttribute("aHighlight", new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1));
	geom.setAttribute("aRow", new THREE.InstancedBufferAttribute(new Float32Array(list.map((_, k) => k)), 1));
	geom.setAttribute("aFull", new THREE.InstancedBufferAttribute(new Float32Array(list.map((b) => b.P)), 1));
	// Arch clip in the plane's uv: bow depth along u, and the wall's half-width across v.
	const span = (b) => b.Lu * 1.45 - b.u0;
	geom.setAttribute("aArch", new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((b) => [ b.dam.bulge * b.dam.halfWidth / span(b), b.dam.halfWidth / (2.9 * b.Lv) ])), 2));
	const bed = bedAtlas(THREE, basins);
	const mat = makeMaterial(THREE, shared, {
		uScale: { value: 0.9 },
		uTintMix: { value: 0.05 },
		uClip: { value: 1 },
		uAlpha: { value: 0.985 },
		uDeep: { value: new THREE.Color(0x174a63) },
		uShallow: { value: new THREE.Color(0x2c7189) },
		uBed: { value: bed.tex },
		uRows: { value: list.length },
		uBedScale: { value: bed.scale },
		uSand: { value: new THREE.Color(0x8f8a6e) },
		uFoamCol: { value: new THREE.Color(0xe8f2f2) },
	});
	const mesh = new THREE.InstancedMesh(geom, mat, list.length);
	mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
	mesh.frustumCulled = false;
	mesh.renderOrder = 2;

	const m = new THREE.Matrix4();
	const basis = new THREE.Matrix4();
	const c = new THREE.Color();
	return {
		mesh,
		// levels[i]: water surface Y; tints[i]: hex/css colour per reservoir; visible[i]
		apply(levels, tints, visible) {
			list.forEach((b, i) => {
				const uMin = b.u0;
				const uMax = b.Lu * 1.45;
				const mid = (uMin + uMax) / 2;
				const [ x, z ] = b.toWorld(mid, 0);
				const sx = visible[i] ? uMax - uMin : 0.0001;
				const sz = visible[i] ? 2.9 * b.Lv : 0.0001;
				basis.makeBasis(new THREE.Vector3(b.eu[0], 0, b.eu[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.ev[0], 0, b.ev[1]));
				m.makeScale(sx, 1, sz).premultiply(basis).setPosition(x, levels[i], z);
				mesh.setMatrixAt(i, m);
				mesh.instanceColor.setXYZ(i, ...c.set(tints[i]).toArray());
			});
			mesh.instanceMatrix.needsUpdate = true;
			mesh.instanceColor.needsUpdate = true;
		},
		setHighlight(index) {
			const arr = geom.attributes.aHighlight.array;
			arr.fill(0);
			if (index >= 0) arr[index] = 1;
			geom.attributes.aHighlight.needsUpdate = true;
		},
	};
}

export function createOcean(THREE, shared) {
	const geom = new THREE.PlaneGeometry(9000, 9000);
	geom.rotateX(-Math.PI / 2);
	const mat = makeMaterial(THREE, shared, {
		uScale: { value: 0.3 },
		uTintMix: { value: 0 },
		uClip: { value: 0 },
		uAlpha: { value: 1 },
		uDeep: { value: new THREE.Color(0x163a52) },
		uShallow: { value: new THREE.Color(0x2c6178) },
		uBed: { value: null },
		uRows: { value: 1 },
		uBedScale: { value: 1 },
		uSand: { value: new THREE.Color(0) },
		uFoamCol: { value: new THREE.Color(0) },
	});
	mat.depthWrite = false;
	const mesh = new THREE.Mesh(geom, mat);
	mesh.position.y = SEA_Y + 0.12;
	mesh.renderOrder = -5; // right after the sky, before any terrain
	return { mesh, material: mat };
}
