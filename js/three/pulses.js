// Flow pulses: small light glints carried downstream along each dam's outflow river. How many
// travel a river and how fast follow that dam's estimated release for the month (release.js:
// storage plus the linked gauges' measured flow). One draw call, a capped pool of points moved
// on the CPU; the pool is smaller on phones.

const VERT = `
	attribute float aAlpha;
	uniform float uPx;
	varying float vA;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vA = aAlpha;
		gl_PointSize = uPx * clamp(70.0 / -mv.z, 1.5, 7.0);
		gl_Position = projectionMatrix * mv;
	}`;

const FRAG = `
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = dot(c, c) * 4.0;
		if (d > 1.0 || vA < 0.01) discard;
		gl_FragColor = vec4(uColor, (1.0 - d) * (1.0 - d) * vA);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

const LIFT = 0.1;

export function createPulses(THREE, lines, { perLine = 8 } = {}) {
	// Each river: its points, cumulative lengths, and a fixed set of slots spread along it.
	const rivers = lines.filter((l) => l.pts.length > 2).map((l) => {
		const cum = [ 0 ];
		for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][2] - l.pts[i - 1][2]));
		const len = cum[cum.length - 1];
		return { dam: l.dam, pts: l.pts, cum, len, slots: Math.max(1, Math.min(perLine, Math.round(len / 4))), first: 0 };
	});
	let n = 0;
	for (const r of rivers) {
		r.first = n;
		n += r.slots;
	}
	const pos = new Float32Array(n * 3);
	const alpha = new Float32Array(n);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
	geom.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms: { uPx: { value: Math.min(2, window.devicePixelRatio || 1) }, uColor: { value: new THREE.Color("#e4f3ff") } },
		transparent: true,
		depthWrite: false,
	});
	const points = new THREE.Points(geom, mat);
	points.frustumCulled = false;
	points.renderOrder = 3;
	const phase = rivers.map(() => 0);
	let active = 0;

	function at(r, s, out) {
		let lo = 0;
		let hi = r.cum.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (r.cum[mid] <= s) lo = mid;
			else hi = mid;
		}
		const t = (s - r.cum[lo]) / ((r.cum[hi] - r.cum[lo]) || 1);
		const a = r.pts[lo];
		const b = r.pts[hi];
		out[0] = a[0] + (b[0] - a[0]) * t;
		out[1] = a[1] + (b[1] - a[1]) * t + LIFT;
		out[2] = a[2] + (b[2] - a[2]) * t;
	}

	const p = [ 0, 0, 0 ];
	return {
		points,
		// release: per-dam 0..1 (eased); on: false hides them all (Rivers off, reduced motion).
		update(dt, release, on) {
			active = 0;
			points.visible = on;
			if (!on) return;
			rivers.forEach((r, ri) => {
				const rel = Math.max(0, Math.min(1, release[r.dam] ?? 0));
				// Faster with more water: about 1 to 4 units a second.
				phase[ri] = (phase[ri] + dt * (1 + 3 * rel)) % r.len;
				// Denser with more water: a trickle shows one or two.
				const shown = rel < 0.02 ? 0 : Math.max(1, Math.round(r.slots * rel));
				for (let j = 0; j < r.slots; j++) {
					const k = r.first + j;
					if (j >= shown) {
						alpha[k] = 0;
						continue;
					}
					const s = (phase[ri] + (j / shown) * r.len) % r.len;
					at(r, s, p);
					pos[k * 3] = p[0];
					pos[k * 3 + 1] = p[1];
					pos[k * 3 + 2] = p[2];
					// Fade in below the dam and out at the river's end.
					const ends = Math.min(1, s / 1.5) * Math.min(1, (r.len - s) / 3);
					alpha[k] = (0.45 + 0.4 * rel) * ends;
					active++;
				}
			});
			geom.attributes.position.needsUpdate = true;
			geom.attributes.aAlpha.needsUpdate = true;
		},
		count: () => (points.visible ? active : 0),
		capacity: n,
		dispose() {
			geom.dispose();
			mat.dispose();
		},
	};
}
