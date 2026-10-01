// River links as glowing tubes with dashes that flow from gauge to reservoir.
import { LAND_H } from "./land.js";
import { meander, flowScale } from "../scales.js";
import { flowAt } from "../data.js";

const BASE_R = 0.5;

const VERT = `
	uniform float uRadius;
	varying vec2 vUv;
	varying float vFacing;
	void main() {
		vUv = uv;
		vec3 p = position + normal * (uRadius - ${BASE_R.toFixed(1)});
		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		vec3 n = normalize(normalMatrix * normal);
		vFacing = abs(dot(n, normalize(-mv.xyz)));
		gl_Position = projectionMatrix * mv;
	}`;

const FRAG = `
	uniform vec3 uColor;
	uniform float uTime;
	uniform float uLen;
	uniform float uSpeed;
	uniform float uOpacity;
	varying vec2 vUv;
	varying float vFacing;
	void main() {
		float d = fract(vUv.x * uLen / 16.0 - uTime * uSpeed);
		float dash = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.35, 0.6, d));
		float core = 0.55 + 0.45 * vFacing;
		vec3 col = uColor * (0.55 + 0.9 * dash) * core;
		gl_FragColor = vec4(col, uOpacity * (0.35 + 0.65 * dash) * core);
	}`;

export function createStreams(THREE, data, project) {
	const group = new THREE.Group();
	const shared = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x2f86c4) }, uOpacity: { value: 0.9 } };
	const items = data.links.map((link) => {
		const a = project([ link.gauge.lon, link.gauge.lat ]);
		const b = project([ link.reservoir.lon, link.reservoir.lat ]);
		const pts2 = meander(link.key, a, b, 14);
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const lift = 3 + len * 0.06;
		const pts = pts2.map(([ x, z ], i) => {
			const t = i / (pts2.length - 1);
			return new THREE.Vector3(x, LAND_H + 1.2 + Math.sin(Math.PI * t) * lift, z);
		});
		const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
		const geom = new THREE.TubeGeometry(curve, Math.max(24, Math.round(len / 4)), BASE_R, 6, false);
		const mat = new THREE.ShaderMaterial({
			vertexShader: VERT,
			fragmentShader: FRAG,
			transparent: true,
			depthWrite: false,
			uniforms: {
				uTime: shared.uTime,
				uColor: shared.uColor,
				uOpacity: shared.uOpacity,
				uLen: { value: curve.getLength() },
				uSpeed: { value: 0.6 },
				uRadius: { value: 0.6 },
			},
		});
		const mesh = new THREE.Mesh(geom, mat);
		mesh.renderOrder = 1;
		group.add(mesh);
		return { link, mesh, mat, radius: 0.6, targetRadius: 0.6 };
	});

	// Gauge stations: small diamonds where each link starts.
	const gaugeGeom = new THREE.OctahedronGeometry(2.6, 0);
	const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x2f86c4, roughness: 0.4, emissive: 0x0b2a40 });
	const gauges = data.gauges.map((g) => {
		const [ x, z ] = project([ g.lon, g.lat ]);
		const m = new THREE.Mesh(gaugeGeom, gaugeMat);
		m.position.set(x, LAND_H + 5, z);
		m.scale.y = 1.4;
		m.castShadow = true;
		m.userData.gauge = g;
		group.add(m);
		return m;
	});

	return {
		group,
		gauges,
		setTargets(dateIndex, instant = false) {
			for (const it of items) {
				const g = it.link.gauge;
				const f = flowAt(g, dateIndex);
				const s = g.flow ? flowScale(f ?? 0) : 0.15;
				it.targetRadius = g.flow ? 0.6 + 2.2 * s : 0.65;
				it.mat.uniforms.uSpeed.value = g.flow ? 0.25 + 1.4 * s : 0.2;
				if (instant) it.radius = it.targetRadius;
			}
		},
		tick(dt, time, animate) {
			if (animate) shared.uTime.value = time;
			const k = 1 - Math.exp(-dt * 6);
			for (const it of items) {
				it.radius += (it.targetRadius - it.radius) * k;
				it.mat.uniforms.uRadius.value = it.radius;
			}
		},
		setTheme(theme, streamColor) {
			shared.uColor.value.set(streamColor);
			const additive = theme === "dark";
			shared.uOpacity.value = additive ? 0.95 : 0.85;
			for (const it of items) {
				it.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
				it.mat.needsUpdate = true;
			}
			gaugeMat.color.set(streamColor);
		},
	};
}
