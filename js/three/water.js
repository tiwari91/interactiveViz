// Water surfaces: one instanced mesh for every reservoir lake and a large ocean
// plane. Shared shader: layered ripples, Fresnel sky reflection, sun glint,
// depth tint, and a faint pull toward each reservoir's "% full" colour.
import { SEA_Y } from "./world.js";

const VERT = `
	varying vec3 vWorld;
	varying vec3 vTint;
	varying float vHi;
	varying vec2 vUv;
	#ifdef USE_INSTANCING
		attribute float aHighlight;
	#endif
	void main() {
		vUv = uv;
		vec4 p = vec4(position, 1.0);
		#ifdef USE_INSTANCING
			p = instanceMatrix * p;
			vHi = aHighlight;
		#else
			vHi = 0.0;
		#endif
		#ifdef USE_INSTANCING_COLOR
			vTint = instanceColor;
		#else
			vTint = vec3(0.0);
		#endif
		vec4 w = modelMatrix * p;
		vWorld = w.xyz;
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
	varying vec3 vWorld;
	varying vec3 vTint;
	varying float vHi;
	varying vec2 vUv;
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
		}
		gDist = length(cameraPosition - vWorld);
		vec2 p = vWorld.xz * uScale;
		vec3 g = wave(p, normalize(vec2(0.8, 0.6)), 1.9, 1.3, 0.05)
			+ wave(p, normalize(vec2(-0.5, 0.9)), 3.1, 1.9, 0.03)
			+ wave(p, normalize(vec2(0.2, -1.0)), 5.7, 2.6, 0.016)
			+ wave(p, normalize(vec2(-0.9, -0.3)), 9.3, 3.4, 0.009);
		vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
		vec3 V = normalize(cameraPosition - vWorld);
		float ndv = max(dot(n, V), 0.0);
		float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
		vec3 R = reflect(-V, n);
		vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.4, 0.0, 1.0));
		vec3 body = mix(uDeep, uShallow, 0.35 + 0.35 * g.z / 0.1);
		body = mix(body, vTint, uTintMix);
		vec3 col = mix(body, sky, fres * 0.75);
		float spec = pow(max(dot(R, uSunDir), 0.0), 260.0);
		col += uSunColor * spec * 2.4;
		col += vec3(0.9, 0.95, 1.0) * vHi * 0.07;
		// Night: moonlit sheen so water still reads against dark land.
		col += uLift * (vec3(0.02, 0.035, 0.055) + uSunColor * spec * 1.5);
		float fog = smoothstep(uFogNear, uFogFar, gDist);
		gl_FragColor = vec4(mix(col, uFogColor, fog), uAlpha);
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

export function createLakes(THREE, basins, shared) {
	const list = basins.basins;
	const geom = new THREE.PlaneGeometry(1, 1);
	geom.rotateX(-Math.PI / 2);
	geom.setAttribute("aHighlight", new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1));
	const mat = makeMaterial(THREE, shared, {
		uScale: { value: 0.9 },
		uTintMix: { value: 0.05 },
		uClip: { value: 1 },
		uAlpha: { value: 0.94 },
		uDeep: { value: new THREE.Color(0x174a63) },
		uShallow: { value: new THREE.Color(0x2c7189) },
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
	});
	mat.depthWrite = false;
	const mesh = new THREE.Mesh(geom, mat);
	mesh.position.y = SEA_Y + 0.12;
	mesh.renderOrder = -5; // right after the sky, before any terrain
	return { mesh, material: mat };
}
