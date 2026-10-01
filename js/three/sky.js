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
		vec3 col = t > 0.0 ? mix(uHorizon, uTop, pow(t, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, -0.25, t));
		float sd = max(dot(d, uSunDir), 0.0);
		col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.22);
		if (uStars > 0.0 && t > 0.05) {
			float s = step(0.9975, hash(floor(d * 520.0)));
			col += vec3(s) * uStars * smoothstep(0.05, 0.4, t) * 0.8;
		}
		gl_FragColor = vec4(col, 1.0);
		#include <encodings_fragment>
	}`;

export const PRESETS = {
	day: {
		label: "Day", top: 0x4a7fc4, horizon: 0xd3e2ee, ground: 0xb9c6cf, sun: [ -0.42, 0.78, 0.46 ], sunColor: 0xfff3df, sunIntensity: 1.25,
		hemiSky: 0xdfe9f5, hemiGround: 0x7d725c, hemiIntensity: 0.6, fog: 0xd3e2ee, fogNear: 900, fogFar: 3000, stars: 0,
		river: 0x3a8cc6, riverHi: 0xe8f7ff, glow: 0, border: 0xffffff, borderOpacity: 0.55,
		deep: 0x174a63, shallow: 0x2c7189, oceanDeep: 0x173d57, oceanShallow: 0x2b6a84,
	},
	golden: {
		label: "Golden hour", top: 0x41639e, horizon: 0xf0bd88, ground: 0x9a7a62, sun: [ -0.86, 0.2, 0.48 ], sunColor: 0xffcf9e, sunIntensity: 1.2,
		hemiSky: 0xd9d4d8, hemiGround: 0x4f4638, hemiIntensity: 0.55, fog: 0xe6c3a0, fogNear: 800, fogFar: 2800, stars: 0,
		river: 0x4f97c4, riverHi: 0xffe2bf, glow: 0.1, border: 0xfff1de, borderOpacity: 0.5,
		deep: 0x22465a, shallow: 0x4e7f88, oceanDeep: 0x1e3f57, oceanShallow: 0x40708a,
	},
	night: {
		label: "Night", top: 0x060b17, horizon: 0x1c2945, ground: 0x0b111d, sun: [ 0.35, 0.62, 0.7 ], sunColor: 0xa9bcff, sunIntensity: 0.42,
		hemiSky: 0x40527a, hemiGround: 0x0e121a, hemiIntensity: 0.42, fog: 0x18233d, fogNear: 700, fogFar: 2500, stars: 1,
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
	const { sky, sun, hemi, scene, water, lakes, ocean, rivers, terrain } = parts;
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
	rivers.setTheme({ color: p.river, highlight: p.riverHi, glow: p.glow });
	terrain.setBorderColor(p.border, p.borderOpacity);
	return p;
}
