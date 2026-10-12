// Weather in the case. The repo has no precipitation or snow data, so clouds, rain, snowpack and
// the groundwater table are illustrative: they follow the calendar and the month-over-month change
// in statewide reservoir storage (CDEC), which is what the lakes themselves show.
import { BOX, FRONT } from "./landscape.js";
import { streakTexture, glowTexture } from "./textures.js";

export function climate(data) {
	const n = data.months.length;
	const wet = new Array(n).fill(0);
	const snow = new Array(n).fill(0);
	const table = new Array(n).fill(0.5);
	const pcts = data.totals.map((t) => t.pct);
	let S = 0;
	for (let i = 0; i < n; i++) {
		const m = data.calMonth[i]; // 0 = January
		const t = data.totals[i];
		const prev = data.totals[Math.max(0, i - 1)];
		const dS = i ? (t.storage - prev.storage) / Math.max(1, t.capacity) : 0;
		const season = [ 1, 1, 1, 0.75, 0.35, 0, 0, 0, 0.1, 0.4, 0.8, 1 ][m];
		// Storage gains in the rainy season read as storms; a little drizzle even in dry winters.
		const p = Math.min(1, Math.max(0, (dS + 0.008) / 0.06)) * season;
		wet[i] = p;
		if (m === 10 || m === 11 || m <= 2) S = Math.min(1, S * 0.97 + p * 0.38 + 0.03);
		else if (m === 3) S *= 0.8;
		else if (m === 4) S *= 0.45;
		else if (m === 5) S *= 0.3;
		else S *= 0.25;
		snow[i] = S;
	}
	// Groundwater lags the surface: two-year trailing mean of statewide % full, scaled to the record.
	const trail = pcts.map((_, i) => {
		const a = pcts.slice(Math.max(0, i - 23), i + 1);
		return a.reduce((s, v) => s + v, 0) / a.length;
	});
	const lo = Math.min(...trail);
	const hi = Math.max(...trail);
	trail.forEach((v, i) => { table[i] = (v - lo) / Math.max(1e-6, hi - lo); });
	return { wet, snow, table };
}

// Puffy clouds from instanced spheres; each cloud drops rain or snow.
export function createWeather(THREE, terrain, quality, motion) {
	const high = quality === "high";
	const group = new THREE.Group();
	const puffGeom = new THREE.IcosahedronGeometry(1, high ? 3 : 2);
	const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x2c3036, envMapIntensity: 0.8 });
	let seed = 3;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	// Cloud A over the Sierra (snows in winter), cloud B over the foothills and coast ranges.
	const clouds = [
		{ x: 1.4, z: -1.9, y: 3.85, r: 1.35, mountain: true, drift: 0.55, phase: 0 },
		{ x: -3.0, z: 0.9, y: 3.55, r: 1.05, mountain: false, drift: 0.45, phase: 2.1 },
	];
	const PUFFS = 26;
	const inst = new THREE.InstancedMesh(puffGeom, cloudMat, clouds.length * PUFFS);
	const puffs = [];
	clouds.forEach((c, ci) => {
		for (let k = 0; k < PUFFS; k++) {
			// A flat-bottomed bank of small puffs along x, with a few larger domes on top.
			const along = (rnd() - 0.5) * 2;
			const across = (rnd() - 0.5) * 2;
			const core = 1 - Math.min(1, Math.hypot(along * 0.8, across));
			const s = c.r * (0.16 + 0.22 * core + rnd() * 0.1);
			puffs.push({ ci, ox: along * c.r * 1.05, oz: across * c.r * 0.5, oy: s * 0.35 + core * c.r * 0.22 + rnd() * 0.05, s });
		}
	});
	group.add(inst);

	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const v = new THREE.Vector3();
	const sc = new THREE.Vector3();
	const col = new THREE.Color();
	const white = new THREE.Color(0xffffff);
	const grey = new THREE.Color(0xaab1ba);

	// Precipitation: rain streaks and snowflakes, recycled when they reach the ground.
	const N = high ? 1800 : 600;
	const makePoints = (tex, size, color, opacity) => {
		const pos = new Float32Array(N * 3);
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		g.setDrawRange(0, 0);
		const mat = new THREE.PointsMaterial({ map: tex, size, color, transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
		const p = new THREE.Points(g, mat);
		p.frustumCulled = false;
		group.add(p);
		return { p, pos, vel: new Float32Array(N) };
	};
	const rain = makePoints(streakTexture(THREE), 0.36, 0xdde9f7, 0.9);
	const snow = makePoints(glowTexture(THREE, [ [ 0, "rgba(255,255,255,1)" ], [ 0.45, "rgba(255,255,255,0.8)" ], [ 1, "rgba(255,255,255,0)" ] ]), 0.07, 0xffffff, 0.95);

	const state = { wet: 0, snowing: false, t: 0, active: [ 0, 0 ] };

	function spawn(sys, i, ci, anywhere) {
		const c = clouds[ci];
		const a = rnd() * Math.PI * 2;
		const d = Math.sqrt(rnd()) * c.r * 0.85;
		const x = c.cx + Math.cos(a) * d * 1.2;
		const z = c.z + Math.sin(a) * d * 0.7;
		const ground = terrain.sample(x, z);
		const top = c.y - 0.05;
		sys.pos[i * 3] = x;
		sys.pos[i * 3 + 1] = anywhere ? ground + rnd() * (top - ground) : top;
		sys.pos[i * 3 + 2] = Math.min(FRONT - 0.05, z);
		sys.vel[i] = 0.8 + rnd() * 0.4;
	}

	function layoutClouds() {
		const tScale = motion() ? 1 : 0;
		let k = 0;
		const grow = 0.75 + 0.4 * state.wet;
		col.copy(white).lerp(grey, Math.min(1, state.wet * 1.1));
		clouds.forEach((c) => {
			c.cx = c.x + Math.sin(state.t * 0.05 * tScale + c.phase) * c.drift;
			const bob = Math.sin(state.t * 0.3 * tScale + c.phase) * 0.03;
			for (const p of puffs) {
				if (clouds[p.ci] !== c) continue;
				const s = p.s * grow;
				m4.compose(v.set(c.cx + p.ox * grow, c.y + p.oy * grow + bob, c.z + p.oz * grow), q, sc.set(s * 1.2, s * 0.9, s));
				inst.setMatrixAt(k, m4);
				// Undersides of storm clouds are darker.
				inst.setColorAt(k, col.clone().multiplyScalar(0.86 + Math.min(0.14, p.oy * 0.5)));
				k++;
			}
		});
		inst.instanceMatrix.needsUpdate = true;
		if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
	}

	const ownerFor = (sys, i) => (sys === snow ? 0 : state.snowing ? 1 : i % 2);

	function setActive(sys, count) {
		const prev = sys.p.geometry.drawRange.count;
		for (let i = prev; i < count; i++) spawn(sys, i, ownerFor(sys, i), true);
		sys.p.geometry.setDrawRange(0, count);
		sys.p.geometry.attributes.position.needsUpdate = true;
	}

	function step(sys, dt, speed, sway) {
		const n = sys.p.geometry.drawRange.count;
		const pos = sys.pos;
		for (let i = 0; i < n; i++) {
			let y = pos[i * 3 + 1] - dt * speed * sys.vel[i];
			if (sway) pos[i * 3] += Math.sin(state.t * 1.3 + i) * dt * sway;
			if (y < terrain.sample(pos[i * 3], pos[i * 3 + 2])) {
				spawn(sys, i, ownerFor(sys, i), false);
				continue;
			}
			pos[i * 3 + 1] = y;
		}
		sys.p.geometry.attributes.position.needsUpdate = true;
	}

	layoutClouds();
	return {
		group,
		// wet 0..1 storm strength, snowing: winter month (cloud A snows over the mountains).
		set(wet, snowing) {
			state.wet = wet;
			state.snowing = snowing;
			layoutClouds();
			const rainCount = Math.round(N * Math.max(0, wet - 0.08) * (snowing ? 0.45 : 1));
			const snowCount = snowing ? Math.round(N * 0.6 * Math.max(0, wet - 0.05)) : 0;
			setActive(rain, rainCount);
			setActive(snow, snowCount);
		},
		tick(t, dt) {
			state.t = t;
			if (!motion()) return;
			layoutClouds();
			step(rain, dt, 5.5, 0);
			step(snow, dt, 0.55, 0.25);
		},
		counts: () => ({ rain: rain.p.geometry.drawRange.count, snow: snow.p.geometry.drawRange.count }),
		clouds,
		BOX,
	};
}
