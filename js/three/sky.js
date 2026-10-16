// Sky dome and time-of-day presets. A preset sets the sky gradient, sun
// direction and colour, hemisphere light, fog, and water/river tones together.
const SKY_VERT = `
	varying vec3 vDir;
	void main() {
		vDir = normalize(position);
		vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		gl_Position = p.xyww;
	}`;

const SKY_FRAG = `
	uniform vec3 uTop;
	uniform vec3 uHorizon;
	uniform vec3 uGround;
	uniform vec3 uSunDir;
	uniform vec3 uSunColor;
	uniform float uStars;
	varying vec3 vDir;
	float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
	void main() {
		vec3 d = normalize(vDir);
		float t = clamp(d.y, -1.0, 1.0);
		// Rayleigh-like gradient: deep blue overhead, paling toward a bright, milky horizon band.
		vec3 col = t > 0.0 ? mix(uHorizon, uTop, pow(t, 0.48)) : mix(uHorizon, uGround, smoothstep(0.0, -0.25, t));
		float band = pow(1.0 - abs(t), 10.0);
		col = mix(col, uHorizon * 1.12, band * 0.55);
		float sd = max(dot(d, uSunDir), 0.0);
		// Mie forward scattering: a wide warm glow around the sun, stronger low in the sky.
		float mie = pow(sd, 5.0) * 0.18 + pow(sd, 36.0) * 0.35 + pow(sd, 400.0) * 0.8;
		col += uSunColor * mie * (0.45 + 0.55 * (1.0 - max(t, 0.0)));
		col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 8.0;
		if (uStars > 0.0 && t > 0.05) {
			float s = step(0.9975, hash(floor(d * 520.0)));
			col += vec3(s) * uStars * smoothstep(0.05, 0.4, t) * 0.8;
		}
		gl_FragColor = vec4(col, 1.0);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

export const PRESETS = {
	day: {
		label: "Day", top: 0x2f68b8, horizon: 0xcfdfec, ground: 0xb9c6cf, sun: [ -0.42, 0.78, 0.46 ], sunColor: 0xfff1dc, sunIntensity: 1.55, env: 0.45,
		hemiSky: 0xdfe9f5, hemiGround: 0x7d725c, hemiIntensity: 0.25, fog: 0xbfd1e3, fogNear: 1100, fogFar: 4200, stars: 0,
		river: 0x3a8cc6, riverHi: 0xe8f7ff, glow: 0, border: 0xffffff, borderOpacity: 0.55,
		deep: 0x123f5a, shallow: 0x2f8a8c, oceanDeep: 0x173d57, oceanShallow: 0x2b6a84,
	},
	golden: {
		label: "Golden hour", top: 0x41639e, horizon: 0xf0bd88, ground: 0x9a7a62, sun: [ -0.86, 0.2, 0.48 ], sunColor: 0xffc890, sunIntensity: 1.6, env: 0.45,
		hemiSky: 0xd9d4d8, hemiGround: 0x4f4638, hemiIntensity: 0.25, fog: 0xe0bc9a, fogNear: 1000, fogFar: 3900, stars: 0,
		river: 0x4f97c4, riverHi: 0xffe2bf, glow: 0.1, border: 0xfff1de, borderOpacity: 0.5,
		deep: 0x22465a, shallow: 0x4e7f88, oceanDeep: 0x1e3f57, oceanShallow: 0x40708a,
	},
	night: {
		label: "Night", top: 0x060b17, horizon: 0x1c2945, ground: 0x0b111d, sun: [ 0.35, 0.62, 0.7 ], sunColor: 0xb4c6ff, sunIntensity: 0.95, env: 0.9,
		hemiSky: 0x6478a4, hemiGround: 0x27303f, hemiIntensity: 0.6, fog: 0x18233d, fogNear: 700, fogFar: 2500, stars: 1,
		river: 0x56c2ff, riverHi: 0xd6f4ff, glow: 0.9, border: 0x9fb8d8, borderOpacity: 0.45,
		deep: 0x0d2232, shallow: 0x1d4a5f, oceanDeep: 0x0a1a2a, oceanShallow: 0x15354a,
	},
};

export function createSky(THREE) {
	const uniforms = {
		uTop: { value: new THREE.Color() },
		uHorizon: { value: new THREE.Color() },
		uGround: { value: new THREE.Color() },
		uSunDir: { value: new THREE.Vector3(0, 1, 0) },
		uSunColor: { value: new THREE.Color() },
		uStars: { value: 0 },
	};
	const mesh = new THREE.Mesh(
		new THREE.SphereGeometry(5000, 32, 16),
		new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false }),
	);
	mesh.renderOrder = -10;
	mesh.frustumCulled = false;
	return { mesh, uniforms };
}

// Apply a preset to every lit or shaded part of the scene.
export function applyPreset(name, parts) {
	const p = PRESETS[name] ?? PRESETS.day;
	const { sky, sun, hemi, scene, water, lakes, ocean, terrain } = parts;
	sky.uniforms.uTop.value.set(p.top);
	sky.uniforms.uHorizon.value.set(p.horizon);
	sky.uniforms.uGround.value.set(p.ground);
	sky.uniforms.uSunColor.value.set(p.sunColor);
	sky.uniforms.uStars.value = p.stars;
	const dir = sky.uniforms.uSunDir.value.set(...p.sun).normalize();
	sun.color.set(p.sunColor);
	sun.intensity = p.sunIntensity;
	sun.userData.dir = dir.clone();
	hemi.color.set(p.hemiSky);
	hemi.groundColor.set(p.hemiGround);
	hemi.intensity = p.hemiIntensity;
	scene.fog.color.set(p.fog);
	scene.fog.near = p.fogNear;
	scene.fog.far = p.fogFar;
	water.uSunDir.value.copy(dir);
	water.uSunColor.value.set(p.sunColor);
	water.uSkyTop.value.set(p.top);
	water.uSkyHorizon.value.set(p.horizon);
	water.uFogColor.value.set(p.fog);
	water.uFogNear.value = p.fogNear;
	water.uFogFar.value = p.fogFar;
	lakes.mesh.material.uniforms.uDeep.value.set(p.deep);
	lakes.mesh.material.uniforms.uShallow.value.set(p.shallow);
	ocean.material.uniforms.uDeep.value.set(p.oceanDeep);
	ocean.material.uniforms.uShallow.value.set(p.oceanShallow);
	terrain.setBorderColor(p.border, p.borderOpacity);
	return p;
}
