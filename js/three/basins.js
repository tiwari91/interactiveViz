// Reservoir basins carved into the terrain. Each reservoir gets an elongated,
// lobed bowl that runs uphill from its dam, a raised rim, and a canyon below the
// dam. The bowl's volume table turns "% of capacity" into a water level, so a
// low reservoir shows a shrunken lake and an exposed shoreline.
import { fbm, hash2 } from "./world.js";

const DAM_U = 0.82; // dam sits this many half-lengths downstream of the lake centre
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function seedOf(id) {
	let h = 7;
	for (let i = 0; i < id.length; i++) h = h * 31 + id.charCodeAt(i);
	return h;
}

export function createBasins(data, world) {
	const maxCap = Math.max(...data.reservoirs.map((r) => r.capacity));
	const basins = data.reservoirs.map((r) => makeBasin(r, maxCap, world));
	const byId = new Map(basins.map((b) => [ b.r.id, b ]));

	// Height of the carved surface at a world point, or null if no basin touches it.
	function surfaceAt(x, z) {
		let best = null;
		for (const b of basins) {
			if (Math.abs(x - b.cx) > b.reach || Math.abs(z - b.cz) > b.reach) continue;
			const s = b.heightAt(x, z);
			if (!s) continue;
			s.basinId = b.r.id;
			if (!best || s.w > best.w + 1e-3 || (Math.abs(s.w - best.w) <= 1e-3 && s.h < best.h)) best = s;
		}
		return best;
	}

	return { basins, byId, surfaceAt };
}

function makeBasin(r, maxCap, world) {
	const [ dx, dz ] = world.project([ r.lon, r.lat ]);
	const k = Math.sqrt(r.capacity / maxCap);
	const Lu = 3.2 + 13 * k;
	const Lv = Lu * 0.48;
	const D = 0.3 * Lu + 0.8;
	const seed = seedOf(r.id);

	// Uphill direction from the dam = the way the lake extends.
	let ux = 0;
	let uz = 0;
	const h0 = world.groundY(dx, dz);
	for (const rad of [ Lu * 0.5, Lu, Lu * 1.6 ]) {
		for (let i = 0; i < 16; i++) {
			const a = (i / 16) * Math.PI * 2;
			const h = world.groundY(dx + Math.cos(a) * rad, dz + Math.sin(a) * rad);
			ux += Math.cos(a) * (h - h0);
			uz += Math.sin(a) * (h - h0);
		}
	}
	let len = Math.hypot(ux, uz);
	if (len < 1e-3) {
		const a = hash2(seed, 3) * Math.PI * 2;
		ux = Math.cos(a);
		uz = Math.sin(a);
		len = 1;
	}
	// Bend the axis a little so neighbouring lakes do not all look aligned.
	const bend = (hash2(seed, 9) - 0.5) * 0.5;
	const ax = ux / len;
	const az = uz / len;
	const eu = [ ax * Math.cos(bend) - az * Math.sin(bend), ax * Math.sin(bend) + az * Math.cos(bend) ];
	const ev = [ -eu[1], eu[0] ];
	const cx = dx + eu[0] * DAM_U * Lu;
	const cz = dz + eu[1] * DAM_U * Lu;

	const ph = [ hash2(seed, 1) * 6.28, hash2(seed, 2) * 6.28, hash2(seed, 4) * 6.28 ];
	// Lobed outline with a few arms; kept round at the dam end so the dam spans it cleanly.
	const lobe = (th) => {
		const away = smooth(Math.min(1, (Math.PI - Math.abs(th)) / 1.1));
		const dev = 0.2 * Math.sin(3 * th + ph[0]) + 0.13 * Math.sin(5 * th + ph[1]) + 0.08 * Math.sin(9 * th + ph[2]);
		return 1 + dev * away;
	};
	const toLocal = (x, z) => {
		const px = x - cx;
		const pz = z - cz;
		return [ px * eu[0] + pz * eu[1], px * ev[0] + pz * ev[1] ];
	};
	const toWorld = (u, v) => [ cx + eu[0] * u + ev[0] * v, cz + eu[1] * u + ev[1] * v ];
	const sOf = (u, v) => {
		const a = u / Lu;
		const b = v / Lv;
		// Domain warp breaks up the ellipse into a more natural, valley-like outline.
		const warp = 1 + (fbm(a * 1.6 + seed * 0.01, b * 1.6, 3) - 0.5) * 0.45 * smooth(Math.min(1, (a + DAM_U) / 0.6));
		return (Math.hypot(a, b) / lobe(Math.atan2(b, a))) * warp;
	};

	// Full-pool level: the lowest natural ground just outside the lake's edge
	// (ignoring the dam side), so the lake sits at a contour and never spills.
	let ringMin = Infinity;
	for (let i = 0; i < 48; i++) {
		const th = (i / 48) * Math.PI * 2;
		const u = Math.cos(th) * Lu * lobe(th) * 1.08;
		if (u < -DAM_U * Lu + Lu * 0.12) continue;
		const [ x, z ] = toWorld(u, Math.sin(th) * Lv * lobe(th) * 1.08);
		ringMin = Math.min(ringMin, world.groundY(x, z));
	}
	const P = Math.max(0.8, (Number.isFinite(ringMin) ? ringMin : h0 + D) - 0.25);
	const rim = P + 0.4;
	const u0 = -DAM_U * Lu;
	const extent = { u: [ -1.95 * Lu, 2.15 * Lu ], v: [ -2.3 * Lv, 2.3 * Lv ] };
	let damHalf = Lv * 0.4; // refined below once the bowl is known

	const bowlShape = (u, v, s, g) => P - D * (1 - Math.pow(s, 1.5)) * g;
	// Lake bed right behind the dam; the canyon below starts a little lower.
	const damFloor = bowlShape(u0 + 0.05, 0, Math.min(0.99, sOf(u0 + 0.05, 0)), 1);

	// Carved height in local coordinates given the natural ground height.
	// Only ever digs down, except small abutments either side of the dam.
	function carve(u, v, orig) {
		let h;
		let zone;
		if (u >= u0) {
			const s = sOf(u, v);
			if (s < 1) {
				const g = 0.55 + 0.45 * Math.min(1, Math.max(0, (0.9 * Lu - u) / (0.9 * Lu - u0)));
				const lumps = (fbm(u * 0.35 + seed, v * 0.35, 3) - 0.5) * 0.3 * D;
				const shape = bowlShape(u, v, s, g) + lumps * (1 - s) * (1 - s);
				h = Math.min(orig, Math.min(shape, P - 0.02));
				zone = "bowl";
			} else if (s < 1.28) {
				const t = smooth((s - 1) / 0.28);
				h = Math.min(orig, P + (Math.max(orig, P) - P) * t);
				zone = t < 0.6 ? "shore" : "outside";
			} else {
				h = orig;
				zone = "outside";
			}
		} else {
			const d = u0 - u;
			const floorY = damFloor - 0.35 - 0.09 * d;
			const cw = damHalf * 0.35 + 0.3 * d;
			const canyon = floorY + Math.pow(Math.abs(v) / cw, 2) * (rim + 1 - floorY);
			h = Math.min(orig, canyon);
			zone = Math.abs(v) < cw ? "canyon" : "outside";
		}
		// Abutments: ground beside the dam ends rises to just above the crest.
		const du = Math.abs(u - u0);
		const av = Math.abs(v);
		if (du < 1.6 && av > damHalf * 0.8 && av < damHalf * 1.9) {
			const k = smooth(1 - du / 1.6) * smooth(1 - Math.abs(av - damHalf * 1.2) / (damHalf * 0.7));
			h = Math.max(h, h + (rim + 0.3 - h) * k * (rim + 0.3 > h ? 1 : 0));
			if (k > 0.3) zone = "abutment";
		}
		return { h, zone };
	}

	function weightAt(u, v) {
		const fu = Math.min((u - extent.u[0]) / (extent.u[1] - extent.u[0]), (extent.u[1] - u) / (extent.u[1] - extent.u[0]));
		const fv = Math.min((v - extent.v[0]) / (extent.v[1] - extent.v[0]), (extent.v[1] - v) / (extent.v[1] - extent.v[0]));
		if (fu <= 0 || fv <= 0) return 0;
		return smooth(Math.min(fu, fv) / 0.16);
	}

	function heightAtLocal(u, v, orig) {
		const w = weightAt(u, v);
		if (w <= 0) return null;
		const c = carve(u, v, orig);
		return { h: orig + (c.h - orig) * w, w, zone: c.zone, u, v };
	}

	const basin = {
		r,
		cx,
		cz,
		eu,
		ev,
		Lu,
		Lv,
		D,
		P,
		rim,
		u0,
		extent,
		reach: Math.hypot(Math.max(-extent.u[0], extent.u[1]), extent.v[1]),
		toLocal,
		toWorld,
		sOf,
		heightAtLocal,
		heightAt(x, z) {
			const [ u, v ] = toLocal(x, z);
			if (u < extent.u[0] || u > extent.u[1] || v < extent.v[0] || v > extent.v[1]) return null;
			return heightAtLocal(u, v, world.groundY(x, z));
		},
		damPoint: [ dx, dz ],
	};

	// Volume table over the bowl, sampled on a fine local grid.
	const floors = [];
	const N = 40;
	for (let i = 0; i <= N; i++) {
		for (let j = 0; j <= N; j++) {
			const u = u0 + ((Lu * 1.35 - u0) * i) / N;
			const v = -Lv * 1.35 + (2.7 * Lv * j) / N;
			if (sOf(u, v) >= 1) continue;
			const [ x, z ] = toWorld(u, v);
			floors.push(carve(u, v, world.groundY(x, z)).h);
		}
	}
	const vol = (L) => floors.reduce((acc, f) => acc + Math.max(0, L - f), 0);
	const vFull = vol(P);
	const minFloor = floors.length ? Math.min(...floors) : P - D;
	basin.levelFor = (pct) => {
		if (pct === null) return minFloor - 0.5;
		const target = Math.max(0, Math.min(1, pct)) * vFull;
		let lo = minFloor;
		let hi = P;
		for (let it = 0; it < 28; it++) {
			const mid = (lo + hi) / 2;
			if (vol(mid) < target) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	};
	basin.minFloor = minFloor;

	// Dam: across the bowl at u0, tied into the abutments.
	let vEdge = Lv * 0.3;
	for (let v = 0; v < Lv * 1.6; v += Lv / 60) {
		if (sOf(u0 + 0.01, v) >= 1 && sOf(u0 + 0.01, -v) >= 1) {
			vEdge = v;
			break;
		}
	}
	damHalf = vEdge * 1.12 + 0.3;
	basin.dam = { u: u0, halfWidth: damHalf, crest: P + 0.35 };
	return basin;
}
