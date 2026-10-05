// Camera moves: eased fly-to for a reservoir and the drought-replay path.
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Spherical pose around a target: azimuth from +z toward +x, polar from straight down.
export function poseToPosition(THREE, { target, dist, polar, az }) {
	const t = new THREE.Vector3(...target);
	return t.clone().add(new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(dist));
}

export function poseOf(THREE, camera, controls) {
	const off = camera.position.clone().sub(controls.target);
	const dist = off.length();
	return { target: controls.target.toArray(), dist, polar: Math.acos(off.y / dist), az: Math.atan2(off.x, off.z) };
}

function lerpPose(a, b, t) {
	let da = b.az - a.az;
	while (da > Math.PI) da -= Math.PI * 2;
	while (da < -Math.PI) da += Math.PI * 2;
	return {
		target: a.target.map((v, i) => v + (b.target[i] - v) * t),
		dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * t),
		polar: a.polar + (b.polar - a.polar) * t,
		az: a.az + da * t,
	};
}

// Returns a per-frame stepper; true when finished.
export function flyTo(THREE, camera, controls, to, duration = 1400) {
	const from = poseOf(THREE, camera, controls);
	const start = performance.now();
	return (now) => {
		const t = Math.min(1, (now - start) / duration);
		const p = lerpPose(from, to, ease(t));
		// Lift a little mid-flight so long moves arc over the terrain.
		p.dist *= 1 + Math.sin(Math.PI * t) * 0.25 * Math.min(1, Math.abs(from.dist - to.dist) / to.dist + 0.3);
		controls.target.set(...p.target);
		camera.position.copy(poseToPosition(THREE, p));
		return t >= 1;
	};
}

// Cinematic path through the state, parameterised 0..1 by replay progress.
// With cut: true (reduced motion) it holds each stop and cuts to the next one,
// so the camera never moves continuously.
export function replayPath(keys, { cut = false } = {}) {
	return (t) => {
		const x = Math.min(0.9999, Math.max(0, t)) * (keys.length - 1);
		const i = Math.floor(x);
		if (cut) {
			const k = keys[Math.min(keys.length - 1, Math.round(x))];
			return { ...k, target: [ ...k.target ] };
		}
		return lerpPose(keys[i], keys[i + 1], ease(x - i));
	};
}
