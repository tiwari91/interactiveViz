// Rivers: terrain-following ribbons (routed along valleys offline, see
// scripts/river_paths.py) from each gauge to its reservoir's dam. Width and flow
// speed follow the gauge's monthly mean flow; flowing ripples run downhill.
import { flowAt } from "../data.js";
import { flowScale } from "../scales.js";

const VERT = `
	attribute float aSide;
	attribute float aAlong;
	attribute float aLink;
	attribute vec3 aDir;
	uniform float uWidth[LINKS];
	uniform float uSpeed[LINKS];
	varying float vSide;
	varying float vPhase;
	varying float vSpeed;
	varying vec3 vWorld;
	void main() {
		int k = int(aLink + 0.5);
		// Wider when seen from far away so rivers stay legible at state scale.
		float far = clamp(distance(cameraPosition, position) / 320.0, 1.0, 4.0);
		float w = uWidth[k] * far;
		vec3 side = normalize(vec3(-aDir.z, 0.0, aDir.x));
		vec3 p = position + side * aSide * w;
		vSide = aSide;
		vPhase = aAlong * 0.55;
		vSpeed = uSpeed[k];
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}`;

const FRAG = `
	uniform float uTime;
	uniform vec3 uColor;
	uniform vec3 uHighlight;
	uniform float uGlow;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	varying float vSide;
	varying float vPhase;
	varying float vSpeed;
	varying vec3 vWorld;
	float hash(float p) { return fract(sin(p * 91.7) * 43758.5); }
	float noise(float p) { float i = floor(p); float f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
	void main() {
		float edge = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
		float ph = vPhase - uTime * vSpeed;
		float rip = noise(ph * 1.7 + vSide * 1.3) * 0.6 + noise(ph * 4.1 - vSide * 2.1) * 0.4;
		// Mostly solid water, with sparse bright glints drifting downstream.
		vec3 col = uColor * (0.88 + 0.22 * rip);
		col = mix(col, uHighlight, smoothstep(0.8, 0.99, rip) * 0.28);
		col *= 1.0 + uGlow * 0.6;
		float dist = length(cameraPosition - vWorld);
		float fog = smoothstep(uFogNear, uFogFar, dist);
		gl_FragColor = vec4(mix(col, uFogColor, fog), edge * 0.92);
		#include <encodings_fragment>
	}`;

export function createRivers(THREE, data, world, basins, paths, shared) {
	const links = data.links;
	const pos = [];
	const side = [];
	const along = [];
	const link = [];
	const dir = [];
	const index = [];
	let base = 0;
	const heightAt = (x, z) => {
		const s = basins.surfaceAt(x, z);
		return Math.max(0.3, s ? s.h : world.groundY(x, z));
	};

	links.forEach((l, li) => {
		const raw = (paths[l.key] ?? [ [ l.gauge.lon, l.gauge.lat ], [ l.reservoir.lon, l.reservoir.lat ] ]).map((p) => world.project(p));
		const target = basins.byId.get(l.reservoir.id);
		// Resample every ~1.1 units.
		const pts = [];
		for (let i = 0; i < raw.length - 1; i++) {
			const [ ax, az ] = raw[i];
			const [ bx, bz ] = raw[i + 1];
			const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.1));
			for (let k = 0; k < n; k++) pts.push([ ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n ]);
		}
		pts.push(raw[raw.length - 1]);
		// Stop at the dam: never draw into the target's lake or over its wall.
		const kept = [];
		for (const p of pts) {
			const [ u, v ] = target.toLocal(p[0], p[1]);
			if (u > target.dam.u - 1.6 && target.sOf(u, v) < 1.4) break;
			if (u > target.dam.u - 1.6 && Math.abs(v) < target.dam.halfWidth * 1.2 && u < target.Lu * 1.5) break;
			kept.push(p);
		}
		if (kept.length < 3) return;
		let seq = kept.map(([ x, z ]) => [ x, heightAt(x, z) + 0.28, z ]);
		// Light smoothing of heights so ribbons do not jitter over the coarse grid.
		seq = seq.map((p, i) => {
			const a = seq[Math.max(0, i - 1)];
			const b = seq[Math.min(seq.length - 1, i + 1)];
			return [ p[0], Math.max(p[1], (a[1] + 2 * p[1] + b[1]) / 4), p[2] ];
		});
		// Animate downhill.
		if (seq[0][1] < seq[seq.length - 1][1]) seq.reverse();
		let dist = 0;
		seq.forEach((p, i) => {
			const a = seq[Math.max(0, i - 1)];
			const b = seq[Math.min(seq.length - 1, i + 1)];
			const dx = b[0] - a[0];
			const dz = b[2] - a[2];
			const len = Math.hypot(dx, dz) || 1;
			if (i > 0) dist += Math.hypot(p[0] - a[0], p[2] - a[2]);
			for (const s of [ -1, 1 ]) {
				pos.push(...p);
				side.push(s);
				along.push(dist);
				link.push(li);
				dir.push(dx / len, 0, dz / len);
			}
			if (i > 0) {
				const o = base + (i - 1) * 2;
				index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
			}
		});
		base += seq.length * 2;
	});

	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
	geom.setAttribute("aLink", new THREE.Float32BufferAttribute(link, 1));
	geom.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 3));
	geom.setIndex(index);
	const widths = new Array(links.length).fill(0.5);
	const speeds = new Array(links.length).fill(0);
	const uniforms = {
		uTime: shared.uTime,
		uFogColor: shared.uFogColor,
		uFogNear: shared.uFogNear,
		uFogFar: shared.uFogFar,
		uWidth: { value: widths },
		uSpeed: { value: speeds },
		uColor: { value: new THREE.Color(0x3b8fc8) },
		uHighlight: { value: new THREE.Color(0xd8f1ff) },
		uGlow: { value: 0 },
	};
	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT.replace(/LINKS/g, String(links.length)),
		fragmentShader: FRAG,
		uniforms,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -4,
		polygonOffsetUnits: -4,
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.renderOrder = 1;
	mesh.frustumCulled = false;

	// Gauge stations: slim markers where each river is measured.
	const gGeom = new THREE.CylinderGeometry(0.18, 0.18, 2.2, 6);
	gGeom.translate(0, 1.1, 0);
	const capGeom = new THREE.SphereGeometry(0.55, 12, 8);
	capGeom.translate(0, 2.4, 0);
	const markerGeom = mergeTwo(THREE, gGeom, capGeom);
	const gMat = new THREE.MeshStandardMaterial({ color: 0x2f86c4, roughness: 0.4, emissive: 0x0b2a40 });
	const gauges = new THREE.InstancedMesh(markerGeom, gMat, data.gauges.length);
	const m = new THREE.Matrix4();
	data.gauges.forEach((g, i) => {
		const [ x, z ] = world.project([ g.lon, g.lat ]);
		m.makeTranslation(x, heightAt(x, z), z);
		gauges.setMatrixAt(i, m);
	});
	gauges.castShadow = true;
	gauges.userData.gauges = data.gauges;

	return {
		mesh,
		gauges,
		widthsFor(dateIndex) {
			return links.map((l) => {
				const g = l.gauge;
				if (!g.flow) return 0.15;
				return 0.13 + 0.42 * flowScale(flowAt(g, dateIndex) ?? 0);
			});
		},
		setWidths(w) {
			for (let i = 0; i < w.length; i++) widths[i] = w[i];
		},
		setTargets(dateIndex) {
			links.forEach((l, i) => {
				const g = l.gauge;
				speeds[i] = g.flow ? 0.4 + 2 * flowScale(flowAt(g, dateIndex) ?? 0) : 0.35;
			});
		},
		setTheme({ color, highlight, glow }) {
			uniforms.uColor.value.set(color);
			uniforms.uHighlight.value.set(highlight);
			uniforms.uGlow.value = glow;
			gMat.color.set(color);
		},
	};
}

function mergeTwo(THREE, a, b) {
	const ga = a.toNonIndexed();
	const gb = b.toNonIndexed();
	const g = new THREE.BufferGeometry();
	for (const name of [ "position", "normal" ]) {
		const arr = new Float32Array(ga.attributes[name].array.length + gb.attributes[name].array.length);
		arr.set(ga.attributes[name].array, 0);
		arr.set(gb.attributes[name].array, ga.attributes[name].array.length);
		g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
	}
	return g;
}
