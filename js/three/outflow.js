// Water leaving every dam: an animated tailrace from the outlet down the canyon
// (always downhill, flat on the ground), an inflow river into each lake, foaming
// water down spillway chutes when a lake is above ~90% full, mist at the base,
// and small warm lights on the dam at night. Width, speed, foam and mist follow
// the same release value that drives the dam's sound (release.js).
import { createRouter, stripGeometry, placeStrip, KIND, ACROSS, CLIMB } from "./outflowPaths.js";
import { stemLines, STEM_DAM } from "./mainRivers.js";

const RIBBON_VERT = `
	attribute float aSide;
	attribute float aAlong;
	attribute vec4 aMeta; // dam, kind, total length, overview weight (big rivers 1)
	attribute vec2 aDir; // horizontal side vector of the strip
	varying float vFar;
	uniform float uRelease[DAMS];
	uniform float uSpill[DAMS];
	uniform float uLevel[DAMS];
	varying float vLevel;
	varying float vYl;
	varying float vSide;
	varying float vAlong;
	varying float vRel;
	varying float vKind;
	varying float vEnd;
	varying vec3 vWorld;
	void main() {
		int k = int(aMeta.x + 0.5);
		float kind = aMeta.y;
		float rel = kind > 1.5 && kind < 2.5 ? uSpill[k] : uRelease[k];
		// Geometry is rebuilt on the ground for each month's width (see placeStrip).
		vec3 p = position + vec3(0.0, 0.03, 0.0);
		// Seen from far away the big rivers widen to stay a few pixels wide, and lift a little
		// so the wider ribbon is not swallowed by the valley sides.
		float camD = distance(cameraPosition, (modelMatrix * vec4(position, 1.0)).xyz);
		vFar = smoothstep(140.0, 700.0, camD) * aMeta.w * step(kind, 1.5);
		p.xz += aDir * aSide * camD * 0.0011 * vFar;
		p.y += camD * 0.004 * vFar;
		vSide = aSide;
		vAlong = aAlong;
		vRel = rel;
		vLevel = uLevel[k];
		vYl = position.y;
		vKind = kind;
		vEnd = aMeta.z - aAlong;
		vec4 wp = modelMatrix * vec4(p, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}`;

const RIBBON_FRAG = `
	uniform float uTime;
	uniform vec3 uWater;
	uniform vec3 uFoam;
	uniform float uNight;
	uniform vec3 uFogColor;
	uniform float uFogNear;
	uniform float uFogFar;
	uniform vec3 uSunDir;
	uniform vec3 uSunColor;
	uniform vec3 uSkyTop;
	uniform vec3 uSkyHorizon;
	uniform vec3 uBank;
	varying float vSide;
	varying float vAlong;
	varying float vRel;
	varying float vLevel;
	varying float vYl;
	varying float vKind;
	varying float vEnd;
	varying vec3 vWorld;
	varying float vFar;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
	}
	// Ripples stretched along the flow and carried downstream.
	float ripple(vec2 p) { return noise(p) * 0.5 + noise(p * 2.3 + 4.1) * 0.3 + noise(p * 5.1 - 2.7) * 0.2; }
	void main() {
		if (vRel < (vKind > 1.5 ? 0.02 : 0.001)) discard;
		// Main stems hand over to the overview line far out (and skip the shading there).
		float mainFade = vKind > 2.5 ? 1.0 - smoothstep(380.0, 560.0, length(cameraPosition - vWorld)) : 1.0;
		if (mainFade <= 0.0) discard;
		// An inflow runs on down the exposed lake bed and disappears under the current water.
		if (vKind > 0.5 && vKind < 1.5 && vYl < vLevel - 0.02) discard;
		float chute = step(1.5, vKind) * step(vKind, 2.5);
		float speed = mix(0.9 + 2.6 * vRel, 7.0, chute);
		float side = abs(vSide);
		// Ground slope under the ribbon (from screen-space derivatives): white water only where
		// the river runs steeply, not as a stroke along its edges.
		vec3 gN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
		float steep = 1.0 - abs(gN.y);
		// The water's edge wanders a little; outside it, wet dark gravel and rock blend into the ground.
		float wob = noise(vec2(vAlong * 0.9, vSide > 0.0 ? 1.7 : 5.3)) - 0.5;
		float waterEdge = mix(0.74, 0.98, chute) + wob * 0.14 * (1.0 - chute);
		float wet = 1.0 - smoothstep(waterEdge - 0.08, waterEdge + 0.02, side);
		wet = mix(wet, 1.0, vFar);
		// Flowing ripples: two octaves scrolled downstream at different speeds, stretched along the flow.
		vec2 q = vec2(vAlong * 1.1 - uTime * speed, vSide * 3.2);
		float h0 = ripple(q);
		float hx = ripple(q + vec2(0.07, 0.0));
		float hy = ripple(q + vec2(0.0, 0.07));
		float rough = 1.8 + 3.0 * vRel + 6.0 * steep;
		vec3 n = normalize(vec3((h0 - hx) * rough, 1.0, (h0 - hy) * rough * 0.5));
		vec3 V = normalize(cameraPosition - vWorld);
		float ndv = max(dot(n, V), 0.0);
		float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
		vec3 R = reflect(-V, n);
		// Reflection of the sky the scene is lit by: bright by day, near black at night.
		vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.4, 0.0, 1.0));
		// Water colour from depth: brown-green over the shallow gravel at the edges, dark teal mid-channel.
		float depth = clamp(1.0 - side / max(0.2, waterEdge), 0.0, 1.0);
		vec3 shallowC = vec3(0.075, 0.08, 0.05);
		vec3 deepC = vec3(0.012, 0.05, 0.055);
		vec3 body = mix(shallowC, deepC, smoothstep(0.05, 0.8, depth)) * (1.0 - 0.75 * uNight);
		vec3 col = mix(body, sky, fres);
		col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 220.0) * (1.4 - 0.6 * uNight);
		// White water: churn just below the outlet, rapids where the bed is steep, aeration on a chute.
		float churn = vKind < 0.5 ? exp(-vAlong / (0.8 + 2.0 * vRel)) : 0.0;
		float streak = noise(vec2(vAlong * 0.8 - uTime * speed * 0.7, vSide * 7.0));
		float rapids = smoothstep(0.18, 0.45, steep) * (0.4 + 0.6 * vRel);
		float foam = smoothstep(0.75, 0.98, h0 * 0.4 + streak * 0.6) * (rapids + churn * 0.8);
		foam += churn * 0.35 * smoothstep(0.3, 0.7, streak);
		// Chute: a thin fast sheet over the concrete, white and aerated in streaks down the steep part.
		float sheet = smoothstep(0.25, 0.8, noise(vec2(vSide * 9.0, vAlong * 0.6 - uTime * 6.0)) * 0.6 + streak * 0.4);
		foam = mix(foam, (0.35 + 0.65 * sheet) * (0.5 + 0.5 * smoothstep(0.1, 0.35, steep)), chute);
		vec3 foamC = uFoam * mix(1.0, 0.18, uNight);
		col = mix(col, foamC, clamp(foam, 0.0, 1.0) * 0.85);
		// Wet bank: dark gravel and rock right at the water, drying and fading into the ground.
		float grit = noise(vec2(vAlong * 6.0, vSide * 9.0));
		float dryness = smoothstep(waterEdge, 1.0, side);
		vec3 bank = mix(uBank * 0.38, uBank * 0.75, dryness) * (0.65 + 0.6 * grit) * (1.0 - 0.7 * uNight);
		col = mix(bank, col, wet);
		// From afar: a clean blue line so the river network reads on the state view (dimmer at night).
		col = mix(col, uWater * mix(1.6, 0.9, uNight) + vec3(0.03, 0.07, 0.11), vFar * 0.75);
		float edge = 1.0 - smoothstep(0.55, 1.0, side) * (1.0 - wet * 0.3);
		float ends = vKind < 0.5 ? smoothstep(0.0, 12.0, vEnd) : vKind < 1.5 ? smoothstep(0.0, 5.0, vAlong) : vKind > 2.5 ? smoothstep(0.0, 1.0, vAlong) : 1.0;
		float a = edge * ends * mainFade * mix(1.0, clamp(vRel * 1.5, 0.0, 1.0), chute) * mix(0.8, 0.98, wet);
		float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));
		gl_FragColor = vec4(mix(col, uFogColor, fog), a);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

const MIST_VERT = `
	attribute vec3 aBase;
	attribute float aDam;
	attribute vec3 aSeed;
	uniform float uTime;
	uniform float uMist[DAMS];
	uniform float uPx;
	varying float vA;
	void main() {
		int k = int(aDam + 0.5);
		float m = uMist[k];
		float t = fract(uTime * (0.18 + 0.12 * aSeed.z) + aSeed.x);
		vec3 p = aBase + vec3((aSeed.y - 0.5) * 2.0 * (0.4 + t), t * (0.8 + 2.2 * m), (aSeed.z - 0.5) * 2.0 * (0.4 + t));
		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		vA = (0.25 + 0.75 * m) * sin(3.14159 * t) * step(0.02, m);
		gl_PointSize = min(48.0, uPx * (0.6 + 1.4 * m) * (0.5 + t) * 380.0 / -mv.z);
		gl_Position = projectionMatrix * mv;
	}`;

const MIST_FRAG = `
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = dot(c, c) * 4.0;
		if (d > 1.0 || vA < 0.01) discard;
		gl_FragColor = vec4(uColor, (1.0 - d) * (1.0 - d) * vA * 0.3);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

const LIGHT_VERT = `
	attribute float aSeed;
	uniform float uTime;
	uniform float uOn;
	uniform float uPx;
	varying float vA;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vA = uOn * (0.8 + 0.2 * sin(uTime * 2.0 + aSeed * 40.0));
		gl_PointSize = uPx * clamp(260.0 / -mv.z, 2.0, 9.0);
		gl_Position = projectionMatrix * mv;
	}`;

const LIGHT_FRAG = `
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = length(c) * 2.0;
		if (d > 1.0 || vA < 0.01) discard;
		float core = smoothstep(1.0, 0.0, d);
		gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * (0.6 + core), core * core * vA);
		#include <tonemapping_fragment>
		#include <encodings_fragment>
	}`;

// Strips are drawn this much wider than the water to hold a gravel bank on each side.
const BANK = 1.12;

export function createOutflow(THREE, basins, dams, world, shared, quality) {
	const list = basins.basins;
	const n = list.length;
	const router = createRouter(basins, world);
	const out = { count: 0, side: [], along: [], meta: [], index: [], dir: [] };
	// Overview weight: the big reservoirs' rivers stay visible from far away.
	const weightOf = (b) => smooth(0.4e6, 1.2e6, b.r.capacity);
	const strips = [];
	const lengths = new Array(n).fill(0);
	// The downstream lake an outflow runs into, if any (e.g. Courtright -> Wishon).
	const into = new Array(n).fill(null);
	const scales = list.map((b) => Math.max(0.7, Math.min(1.6, dams.info.get(b.r.id).scale)));
	const smooth = (a, b, x) => {
		const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
		return t * t * (3 - 2 * t);
	};
	const ground = (x, z) => router.surface(x, z) + router.OFFSET;

	// Outflow paths first, biggest rivers first: a smaller river that reaches one already
	// laid down ends at the confluence instead of crossing it.
	const outSeq = new Array(n).fill(null);
	const joins = new Array(n).fill(null);
	const JOIN = 1.1;
	const cell = (x, z) => `${Math.floor(x / JOIN)},${Math.floor(z / JOIN)}`;
	const trunk = new Map();
	const endings = [];

	// Main-stem rivers and Delta channels on a coarse grid. An outflow never stops dead on a
	// slope: it runs on down the valley floor to the main stem it really feeds, into a lake, or
	// (far from any main stem, e.g. the Kings and Kern sinking into the Tulare basin) out onto
	// flat valley ground, where it fades.
	const STEM_CELL = 4;
	const ONWARD_MAX = 140;
	const stemGrid = new Map();
	const stemPts = [];
	const stems = stemLines(world);
	for (const line of stems) {
		for (const p of line) {
			stemPts.push(p);
			const key = `${Math.floor(p[0] / STEM_CELL)},${Math.floor(p[1] / STEM_CELL)}`;
			if (!stemGrid.has(key)) stemGrid.set(key, []);
			stemGrid.get(key).push(p);
		}
	}
	const nearStem = (x, z, r) => {
		const cx = Math.floor(x / STEM_CELL);
		const cz = Math.floor(z / STEM_CELL);
		let best = null;
		let bd = r;
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				for (const p of stemGrid.get(`${cx + i},${cz + j}`) ?? []) {
					const d = Math.hypot(p[0] - x, p[1] - z);
					if (d < bd) {
						bd = d;
						best = p;
					}
				}
			}
		}
		return best;
	};
	const lakeAt = (x, z, own, s = 1.0) => list.find((o) => o !== own && Math.abs(x - o.cx) < o.reach && Math.abs(z - o.cz) < o.reach && o.sOf(...o.toLocal(x, z)) < s);
	const nearestStem = (x, z) => {
		let best = null;
		let bd = Infinity;
		for (const p of stemPts) {
			const d = Math.hypot(p[0] - x, p[1] - z);
			if (d < bd) {
				bd = d;
				best = p;
			}
		}
		return [ best, bd ];
	};
	const ground2 = (x, z) => router.surface(x, z);
	// The open sea or a bay (west of the Delta, whose islands also sit below sea level).
	const atSea = (x, z) => {
		const [ lon, lat ] = world.unproject(x, z);
		return lon < -121.86 && world.metresAt(lon, lat) <= 0;
	};
	// Carry a ground path on from where steepest descent gave up: down the valley floor
	// (lowest ground in a cone around the way to the nearest main stem), never climbing.
	function onward(pts, own) {
		// A river that reaches another lake ends at its shore.
		const enters = pts.findIndex(([ x, z ], i) => i > 2 && lakeAt(x, z, own));
		if (enters > 0) return pts.slice(0, enters + 1);
		const out = pts.slice();
		let [ px, pz ] = out[out.length - 1];
		if (nearStem(px, pz, 1.2) || lakeAt(px, pz, own)) return out;
		const prev = out[Math.max(0, out.length - 3)];
		let hx = px - prev[0];
		let hz = pz - prev[1];
		let [ tgt, td ] = nearestStem(px, pz);
		const reach = td < ONWARD_MAX;
		if (Math.hypot(hx, hz) < 1e-6) [ hx, hz ] = [ tgt[0] - px, tgt[1] - pz ];
		let l = Math.hypot(hx, hz) || 1;
		hx /= l;
		hz /= l;
		let low = ground2(px, pz);
		const STEP = router.STEP;
		const steps = Math.ceil((reach ? td * 2.5 : 90) / STEP);
		for (let s = 0; s < steps; s++) {
			// Far from any main stem: run on until the ground levels out onto a valley floor.
			if (!reach && s * STEP > 10) {
				const sl = Math.hypot(ground2(px + 1, pz) - ground2(px - 1, pz), ground2(px, pz + 1) - ground2(px, pz - 1)) / 2;
				if (sl < 0.08) break;
			}
			if (reach && s % 20 === 19) [ tgt ] = nearestStem(px, pz);
			let bx = hx;
			let bz = hz;
			if (reach) {
				const tl = Math.hypot(tgt[0] - px, tgt[1] - pz) || 1;
				bx = hx * 0.45 + ((tgt[0] - px) / tl) * 0.55;
				bz = hz * 0.45 + ((tgt[1] - pz) / tl) * 0.55;
				l = Math.hypot(bx, bz) || 1;
				bx /= l;
				bz /= l;
			}
			let best = null;
			for (let a = -1.4; a <= 1.4001; a += 0.2) {
				const dx = bx * Math.cos(a) - bz * Math.sin(a);
				const dz = bx * Math.sin(a) + bz * Math.cos(a);
				const q = [ px + dx * STEP, pz + dz * STEP ];
				const g = ground2(...q);
				const score = g + Math.abs(a) * (reach ? 0.05 : 0.02);
				if (!best || score < best.score) best = { q, g, score, dx, dz };
			}
			// Never back over the dam into its own lake.
			{
				const [ uq, vq ] = own.toLocal(...best.q);
				if (uq > own.dam.u - 0.3 && own.sOf(uq, vq) < 1.3) best.g = Infinity;
			}
			if (best.g > low + CLIMB * 0.8) {
				// Blocked ahead: any way round that does not climb, short of turning back on itself.
				for (let a = -2.6; a <= 2.6001; a += 0.2) {
					const dx = hx * Math.cos(a) - hz * Math.sin(a);
					const dz = hx * Math.sin(a) + hz * Math.cos(a);
					const q = [ px + dx * STEP, pz + dz * STEP ];
					const g = ground2(...q);
					const [ uq, vq ] = own.toLocal(...q);
					if (uq > own.dam.u - 0.3 && own.sOf(uq, vq) < 1.3) continue;
					if (g < best.g) best = { q, g, score: g, dx, dz };
				}
				if (best.g > low + CLIMB * 0.8) break;
			}
			[ px, pz ] = best.q;
			out.push(best.q);
			hx = hx * 0.5 + best.dx * 0.5;
			hz = hz * 0.5 + best.dz * 0.5;
			l = Math.hypot(hx, hz) || 1;
			hx /= l;
			hz /= l;
			low = Math.min(low, best.g);
			const hit = nearStem(px, pz, 1.2);
			if (hit) {
				out.push(hit);
				break;
			}
			if (lakeAt(px, pz, own) || atSea(px, pz)) break;
		}
		return out;
	}
	function upValley(own, maxLen) {
		let u = 0;
		while (u < own.Lu * 2 && own.sOf(u, 0) < 1) u += 0.2;
		let [ px, pz ] = own.toWorld(u + 0.3, 0);
		const path = [ [ px, pz ] ];
		let high = ground2(px, pz);
		let [ hx, hz ] = own.eu;
		const STEP = router.STEP;
		for (let walked = 0; walked < maxLen; walked += STEP) {
			let best = null;
			for (let a = -1.2; a <= 1.2001; a += 0.2) {
				const dx = hx * Math.cos(a) - hz * Math.sin(a);
				const dz = hx * Math.sin(a) + hz * Math.cos(a);
				const q = [ px + dx * STEP, pz + dz * STEP ];
				const g = ground2(...q);
				if (g < high - CLIMB * 0.8 || own.sOf(...own.toLocal(...q)) < 1) continue;
				const score = g + Math.abs(a) * 0.05;
				if (!best || score < best.score) best = { q, g, score, dx, dz };
			}
			if (!best) break;
			[ px, pz ] = best.q;
			path.push(best.q);
			high = Math.max(high, best.g);
			hx = hx * 0.55 + best.dx * 0.3 + own.eu[0] * 0.15;
			hz = hz * 0.55 + best.dz * 0.3 + own.eu[1] * 0.15;
			const l = Math.hypot(hx, hz) || 1;
			hx /= l;
			hz /= l;
		}
		return path.reverse();
	}
	// Carry an inflow on from the full-pool shore down the lake bed toward the dam, so it always
	// reaches the water however low the lake is (the part under water is hidden).
	// Carry an inflow on from the full-pool shore across the lake bed to its deepest point, so it
	// meets the water however low the lake is (the part under water is hidden). The route is the
	// one water itself would take: a priority flood from the shore (lowest pass first) to the bottom.
	function intoBed(pts, own) {
		const out = pts.slice();
		const H = 0.4;
		const [ ua, ub ] = [ own.u0 - 0.5, own.Lu * 1.4 ];
		const [ va, vb ] = [ -own.Lv * 1.4, own.Lv * 1.4 ];
		const nu = Math.ceil((ub - ua) / H) + 1;
		const nv = Math.ceil((vb - va) / H) + 1;
		const N = nu * nv;
		const hgt = new Float32Array(N).fill(Infinity);
		let bottom = -1;
		for (let i = 0; i < nu; i++) {
			for (let j = 0; j < nv; j++) {
				const u = ua + i * H;
				const v = va + j * H;
				const sv = own.sOf(u, v);
				if (sv > 1.1 || u < own.dam.u + 0.4) continue;
				const k = i * nv + j;
				hgt[k] = ground2(...own.toWorld(u, v));
				if (sv < 1 && (bottom < 0 || hgt[k] < hgt[bottom])) bottom = k;
			}
		}
		const [ sx, sz ] = out[out.length - 1];
		const [ su, sv ] = own.toLocal(sx, sz);
		let start = -1;
		let sd = Infinity;
		for (let k = 0; k < N; k++) {
			if (hgt[k] === Infinity) continue;
			const d = Math.hypot(ua + Math.floor(k / nv) * H - su, va + (k % nv) * H - sv);
			if (d < sd) {
				sd = d;
				start = k;
			}
		}
		if (start < 0 || bottom < 0) return out;
		const key = new Float32Array(N).fill(Infinity);
		const prev = new Int32Array(N).fill(-1);
		const done = new Uint8Array(N);
		const heap = [];
		const push = (k) => {
			heap.push(k);
			let c = heap.length - 1;
			while (c > 0) {
				const p = (c - 1) >> 1;
				if (key[heap[p]] <= key[heap[c]]) break;
				[ heap[p], heap[c] ] = [ heap[c], heap[p] ];
				c = p;
			}
		};
		const pop = () => {
			const top = heap[0];
			const last = heap.pop();
			if (heap.length) {
				heap[0] = last;
				let c = 0;
				for (;;) {
					const l = c * 2 + 1;
					const r = l + 1;
					let m = c;
					if (l < heap.length && key[heap[l]] < key[heap[m]]) m = l;
					if (r < heap.length && key[heap[r]] < key[heap[m]]) m = r;
					if (m === c) break;
					[ heap[m], heap[c] ] = [ heap[c], heap[m] ];
					c = m;
				}
			}
			return top;
		};
		key[start] = hgt[start];
		push(start);
		while (heap.length) {
			const k = pop();
			if (done[k]) continue;
			done[k] = 1;
			if (k === bottom) break;
			const i = Math.floor(k / nv);
			const j = k % nv;
			for (const [ di, dj ] of [ [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ], [ 1, 1 ], [ 1, -1 ], [ -1, 1 ], [ -1, -1 ] ]) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
				const q = ii * nv + jj;
				if (done[q] || hgt[q] === Infinity) continue;
				// Lowest pass first; among equal passes, the lower ground.
				const kq = Math.max(key[k], hgt[q]) + hgt[q] * 1e-3;
				if (kq < key[q]) {
					key[q] = kq;
					prev[q] = k;
					push(q);
				}
			}
		}
		if (!done[bottom]) return out;
		const route = [];
		for (let k = bottom; k >= 0 && k !== start; k = prev[k]) route.push(own.toWorld(ua + Math.floor(k / nv) * H, va + (k % nv) * H));
		return out.concat(route.reverse());
	}
	const order = list.map((_, i) => i).sort((a, b) => list[b].r.capacity - list[a].r.capacity);
	for (const di of order) {
		const b = list[di];
		const info = dams.info.get(b.r.id);
		// From the downstream toe, along the canyon floor, then downhill.
		// Arch dams bulge upstream, so start below the dam line, never in the lake.
		const foot = [ info.toePoint[0], info.toePoint[2] ];
		const toe = info.toeU <= b.dam.u - 0.6 ? foot : b.toWorld(b.dam.u - 0.6, b.toLocal(...foot)[1]);
		const raw0 = router.downhill(toe, [ -b.eu[0], -b.eu[1] ], 24 + b.Lu * 2.4, { avoid: b });
		const pts = onward(raw0, b);
		let seq = router.drape(pts);
		// An arch bulges upstream, so the search starts below the dam line; the river itself still
		// leaves from the foot of the wall, running straight (never below where it starts) to there.
		if (toe !== foot && seq.length) {
			const steps = Math.ceil(Math.hypot(toe[0] - foot[0], toe[1] - foot[1]) / 0.3);
			for (let k = steps - 1; k >= 0; k--) {
				const x = foot[0] + (toe[0] - foot[0]) * k / steps;
				const z = foot[1] + (toe[1] - foot[1]) * k / steps;
				seq.unshift([ x, Math.max(seq[0][1], ground(x, z)), z ]);
			}
		}
		for (let k = 6; k < seq.length; k++) {
			const [ x, , z ] = seq[k];
			let hit = null;
			for (let i = -1; i <= 1 && !hit; i++) {
				for (let j = -1; j <= 1 && !hit; j++) {
					for (const t of trunk.get(`${Math.floor(x / JOIN) + i},${Math.floor(z / JOIN) + j}`) ?? []) {
						if (t.di !== di && Math.hypot(t.p[0] - x, t.p[2] - z) < JOIN) {
							hit = t;
							break;
						}
					}
				}
			}
			if (hit) {
				seq = seq.slice(0, k);
				const last = seq[seq.length - 1];
				// Run on into the bigger river, unless that point lies back the way it came.
				const prev = seq[Math.max(0, seq.length - 4)];
				const ax = last[0] - prev[0];
				const az = last[2] - prev[2];
				const bx = hit.p[0] - last[0];
				const bz = hit.p[2] - last[2];
				if ((ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1) > -0.34) seq.push([ hit.p[0], Math.min(last[1], hit.p[1]), hit.p[2] ]);
				joins[di] = list[hit.di].r.id;
				break;
			}
		}
		outSeq[di] = seq;
		for (const p of seq) {
			const key = cell(p[0], p[2]);
			if (!trunk.has(key)) trunk.set(key, []);
			trunk.get(key).push({ p, di });
		}
	}

	list.forEach((b, di) => {
		const info = dams.info.get(b.r.id);
		const sc = scales[di];
		const seq = outSeq[di];
		if (seq.length > 2) {
			// A river that stops just short of a main stem runs on onto it, so the two ribbons meet:
			// from the point of its last stretch closest to the stem, and never turning back.
			let onto = null;
			if (!joins[di] && nearStem(seq[seq.length - 1][0], seq[seq.length - 1][2], 1.6)) {
				let bestK = seq.length - 1;
				let bestD = Infinity;
				for (let k = seq.length - 1; k >= Math.max(3, seq.length - 12); k--) {
					const q = nearStem(seq[k][0], seq[k][2], 2.5);
					const d = q ? Math.hypot(q[0] - seq[k][0], q[1] - seq[k][2]) : Infinity;
					if (d < bestD - 0.02) {
						bestD = d;
						bestK = k;
					}
				}
				seq.length = bestK + 1;
				const t = seq[bestK];
				const h = seq[bestK - 3];
				const q = nearStem(t[0], t[2], 2.5);
				const dx = t[0] - h[0];
				const dz = t[2] - h[2];
				if (q && (q[0] - t[0]) * dx + (q[1] - t[2]) * dz >= -0.26 * Math.hypot(q[0] - t[0], q[1] - t[2]) * Math.hypot(dx, dz)) onto = q;
			}
			const tail = seq[seq.length - 1];
			if (onto && Math.hypot(onto[0] - tail[0], onto[1] - tail[2]) > 0.3) {
				const n = Math.ceil(Math.hypot(onto[0] - tail[0], onto[1] - tail[2]) / 0.4);
				for (let k = 1; k <= n; k++) {
					const x = tail[0] + (onto[0] - tail[0]) * k / n;
					const z = tail[2] + (onto[1] - tail[2]) * k / n;
					seq.push([ x, ground(x, z), z ]);
				}
			}
			// How the river ends: at another dam's river, a main stem, a lake, or fading out on
			// flat valley ground. Only the last fades; the others run on into what they meet.
			const [ ex, , ez ] = seq[seq.length - 1];
			const ending = joins[di] ? "river" : nearStem(ex, ez, 1.6) ? "stem" : lakeAt(ex, ez, b, 1.4) ? "lake" : atSea(ex, ez) ? "sea" : "fade";
			const slope = Math.hypot(ground2(ex + 1, ez) - ground2(ex - 1, ez), ground2(ex, ez + 1) - ground2(ex, ez - 1)) / 2;
			// Lowest ground a little way round the end, relative to the end: >= 0 means the water
			// sits in a hollow with nowhere lower to go.
			let drop = Infinity;
			for (let k = 0; k < 16; k++) drop = Math.min(drop, ground2(ex + Math.cos(k * Math.PI / 8) * 1.5, ez + Math.sin(k * Math.PI / 8) * 1.5) - ground2(ex, ez));
			endings.push({ id: b.r.id, ending, x: +ex.toFixed(2), z: +ez.toFixed(2), slope: +slope.toFixed(3), drop: +drop.toFixed(3), length: 0 });
			const st = stripGeometry(seq, out, { dam: di, kind: KIND.OUTFLOW, joins: ending !== "fade", weight: weightOf(b) });
			endings[endings.length - 1].length = +st.length.toFixed(1);
			// Narrow at the outlet, wide tailrace, then a natural river width.
			// A river that fades out (sinking into the valley floor) dwindles over its last stretch.
			const total = st.length;
			const dwindle = ending === "fade" ? (d) => 0.06 + 0.94 * smooth(0, 14, total - d) : () => 1;
			const shape = (i, d) => sc * (0.55 + 0.45 * smooth(0, 3, d)) * (1 - 0.5 * smooth(5, 16, d)) * dwindle(d);
			strips.push({ ...st, kind: KIND.OUTFLOW, dam: di, taper: [ false, ending === "fade" ], centre: seq, shape, sample: ground });
			lengths[di] = st.length;
			const end = seq[seq.length - 1];
			const next = list.find((o) => o !== b && o.sOf(...o.toLocal(end[0], end[2])) < 1.4);
			if (next) into[di] = next.r.id;
		}

		// Inflow: traced from the lake's upstream shore up the valley floor (lowest ground that
		// never drops going upstream, so the river never climbs going down), then carried from
		// the shore across the lake bed toward the dam, so it meets the water at any level.
		const inPts = intoBed(upValley(b, b.Lu * 1.6 + 12), b);
		const inSeq = router.drape(inPts);
		if (inSeq.length > 6) {
			const st = stripGeometry(inSeq, out, { dam: di, kind: KIND.INFLOW, weight: weightOf(b) });
			const shape = (i) => sc * (0.6 + 0.4 * (i / inSeq.length));
			strips.push({ ...st, kind: KIND.INFLOW, dam: di, centre: inSeq, shape, sample: ground });
		}

		// Spillway chute (embankment dams): white water on the chute floor itself.
		if (info.chute) {
			const st = stripGeometry(info.chute, out, { dam: di, kind: KIND.CHUTE });
			strips.push({ ...st, kind: KIND.CHUTE, dam: di, centre: info.chute, shape: () => info.chuteWidth, sample: (x, z, y) => y });
		}
	});

	// Main stems and Delta channels as the same ribbon, so close up a river below a dam runs on
	// into the Sacramento or San Joaquin instead of meeting a line that has faded out. Each
	// carries the release of the big dam above it; on the valley floor it never fades.
	const damIndex = new Map(list.map((b, i) => [ b.r.id, i ]));
	const mainRuns = [];
	for (const line of stems) {
		const di = damIndex.get(STEM_DAM[line.name] ?? "SHA");
		if (di === undefined) continue;
		// Only on the valley floor and away from the reservoirs' carved ground: in the foothill
		// canyons and around the lakes the outflow ribbons already run.
		// Start where the first dam's river joins it, so a dam's outflow and the main stem do not
		// run side by side below the dam.
		let from = 0;
		const joinsHere = endings.filter((e) => e.ending === "stem").map((e) => line.findIndex(([ x, z ]) => Math.hypot(x - e.x, z - e.z) < 1.7)).filter((i) => i >= 0);
		if (joinsHere.length) from = Math.min(...joinsHere);
		const runs = [];
		let run = [];
		for (const [ x, z ] of line.slice(from)) {
			if (!lakeAt(x, z, null, 1.0)) run.push([ x, ground2(x, z) + router.OFFSET, z ]);
			else if (run.length) {
				runs.push(run);
				run = [];
			}
		}
		if (run.length) runs.push(run);
		const wide = line.name in STEM_DAM ? 0.85 : 0.6;
		for (const seq of runs) if (seq.length >= 3) mainRuns.push({ line, di, wide, seq, taper: [ false, false ] });
	}
	// The waypoints are approximate, so a tributary can end (or a Delta channel start) a few
	// kilometres short of the river it meets. Close any such gap with a short reach to the nearest
	// point of the other ribbon; an end with no ribbon near it (a river whose dam is not drawn)
	// narrows to nothing instead of stopping square.
	const REACH = 9;
	// Rivers join rivers (or a dam's outflow); a Delta channel joins those first and another
	// channel only when no river is near, so two channels that start at one junction never
	// just hook onto each other, adrift from the river they leave.
	const outflowLines = strips.filter((st) => st.kind === KIND.OUTFLOW).map((st) => st.centre);
	const isRiver = (r) => r.line.name in STEM_DAM;
	const others = (self, any) => [ ...mainRuns.filter((r) => r !== self && (any || isRiver(r))).map((r) => r.seq), ...outflowLines ];
	for (const r of mainRuns) {
		for (const atEnd of [ false, true ]) {
			const end = atEnd ? r.seq[r.seq.length - 1] : r.seq[0];
			if (lakeAt(end[0], end[2], null, 1.6) || atSea(end[0], end[2])) continue;
			let pool = others(r, false);
			// Nearest point of another river that the line can reach without turning back on itself
			// (the reach leaves within about 105 degrees of the line's own heading at that point).
			const nearest = (p, i) => {
				const j = Math.max(0, Math.min(r.seq.length - 1, i + (atEnd ? -3 : 3)));
				const hx = p[0] - r.seq[j][0];
				const hz = p[2] - r.seq[j][2];
				const hl = Math.hypot(hx, hz) || 1;
				let best = null;
				let bd = Infinity;
				for (const seq of pool) {
					for (const q of seq) {
						const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
						if (d > 0.5 && ((q[0] - p[0]) * hx + (q[2] - p[2]) * hz) / (d * hl) < -0.26) continue;
						if (d < bd) {
							bd = d;
							best = q;
						}
					}
				}
				return [ bd, best ];
			};
			// Where along its last (or first) stretch the line comes closest to another river: a
			// waypoint end that overshoots past the junction is cut back there, so the join never
			// doubles back into a hook.
			const span = Math.min(40, Math.floor(r.seq.length / 3));
			let pick = { i: atEnd ? r.seq.length - 1 : 0, d: Infinity, q: null };
			for (let k = 0; k <= span; k++) {
				const i = atEnd ? r.seq.length - 1 - k : k;
				const [ d, q ] = nearest(r.seq[i], i);
				if (d < pick.d - 0.05) pick = { i, d, q };
			}
			if (pick.d > REACH && !isRiver(r)) {
				pool = others(r, true);
				pick = { i: atEnd ? r.seq.length - 1 : 0, d: Infinity, q: null };
				for (let k = 0; k <= span; k++) {
					const i = atEnd ? r.seq.length - 1 - k : k;
					const [ d, q ] = nearest(r.seq[i], i);
					if (d < pick.d - 0.05) pick = { i, d, q };
				}
			}
			if (pick.d > REACH) {
				r.taper[atEnd ? 1 : 0] = true;
				continue;
			}
			if (atEnd) r.seq.length = pick.i + 1;
			else r.seq.splice(0, pick.i);
			if (pick.d <= 0.5) continue;
			const p = r.seq[atEnd ? r.seq.length - 1 : 0];
			const n = Math.ceil(pick.d / 0.5);
			const link = [];
			for (let k = 1; k <= n; k++) {
				const x = p[0] + (pick.q[0] - p[0]) * k / n;
				const z = p[2] + (pick.q[2] - p[2]) * k / n;
				link.push([ x, ground2(x, z) + router.OFFSET, z ]);
			}
			if (atEnd) r.seq.push(...link);
			else r.seq.unshift(...link.reverse());
		}
	}
	for (const { line, di, wide, seq, taper } of mainRuns) {
		{
			// The ribbon carries the main stem from close up to the state view (where a cheap line
			// takes over), so a river below a dam always has the main stem it runs into. Narrower where the ground slopes
			// steeply across it, so it never bridges a valley side.
			const st = stripGeometry(seq, out, { dam: di, kind: KIND.MAIN, joins: true, weight: 0 });
			const narrow = seq.map((p, i) => {
				const [ sx, sz ] = st.frames[i];
				const cross = Math.abs(ground2(p[0] + sx * 1.5, p[2] + sz * 1.5) - ground2(p[0] - sx * 1.5, p[2] - sz * 1.5)) / 3;
				return Math.max(0.45, 1 - cross * 1.6);
			});
			const along = [ 0 ];
			for (let i = 1; i < seq.length; i++) along.push(along[i - 1] + Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][2] - seq[i - 1][2]));
			const total = along[along.length - 1];
			const ends = (i) => (taper[0] ? smooth(0, 6, along[i]) : 1) * (taper[1] ? smooth(0, 6, total - along[i]) : 1);
			strips.push({ ...st, kind: KIND.MAIN, dam: di, name: line.name, taper, centre: seq, shape: (i) => wide * narrow[i] * (0.04 + 0.96 * ends(i)), sample: ground });
		}
	}

	const positions = new Float32Array(out.count * 3);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geom.setAttribute("aSide", new THREE.Float32BufferAttribute(out.side, 1));
	geom.setAttribute("aAlong", new THREE.Float32BufferAttribute(out.along, 1));
	geom.setAttribute("aMeta", new THREE.Float32BufferAttribute(out.meta, 4));
	geom.setAttribute("aDir", new THREE.Float32BufferAttribute(out.dir, 2));
	geom.setIndex(out.index);
	const release = new Array(n).fill(0);
	const levelU = new Array(n).fill(-100);
	const spill = new Array(n).fill(0);
	const night = { value: 0 };
	const ribbonMat = new THREE.ShaderMaterial({
		vertexShader: RIBBON_VERT.replace(/DAMS/g, String(n)),
		fragmentShader: RIBBON_FRAG,
		uniforms: {
			uTime: shared.uTime,
			uFogColor: shared.uFogColor,
			uFogNear: shared.uFogNear,
			uFogFar: shared.uFogFar,
			uRelease: { value: release },
			uLevel: { value: levelU },
			uSpill: { value: spill },
			uSunDir: shared.uSunDir,
			uSunColor: shared.uSunColor,
			uSkyTop: shared.uSkyTop,
			uSkyHorizon: shared.uSkyHorizon,
			uBank: { value: new THREE.Color(0x6e6352) },
			uWater: { value: new THREE.Color(0x2f7186) },
			uFoam: { value: new THREE.Color(0xf2fbff) },
			uNight: night,
		},
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		extensions: { derivatives: true },
		polygonOffset: true,
		polygonOffsetFactor: -6,
		polygonOffsetUnits: -6,
	});
	const ribbon = new THREE.Mesh(geom, ribbonMat);
	ribbon.renderOrder = 4;
	ribbon.frustumCulled = false;

	// Mist at each outlet (and spillway foot).
	const perDam = quality === "high" ? 26 : 10;
	const mBase = [];
	const mDam = [];
	const mSeed = [];
	list.forEach((b, di) => {
		const info = dams.info.get(b.r.id);
		for (let k = 0; k < perDam; k++) {
			const at = k % 3 === 2 && info.spillBottom ? info.spillBottom : info.toePoint;
			mBase.push(at[0], at[1] + 0.2, at[2]);
			mDam.push(di);
			mSeed.push(Math.random(), Math.random(), Math.random());
		}
	});
	const mGeom = new THREE.BufferGeometry();
	mGeom.setAttribute("position", new THREE.Float32BufferAttribute(mBase, 3));
	mGeom.setAttribute("aBase", new THREE.Float32BufferAttribute(mBase, 3));
	mGeom.setAttribute("aDam", new THREE.Float32BufferAttribute(mDam, 1));
	mGeom.setAttribute("aSeed", new THREE.Float32BufferAttribute(mSeed, 3));
	const mist = new Array(n).fill(0);
	const px = { value: Math.min(window.devicePixelRatio || 1, 2) };
	const mistMat = new THREE.ShaderMaterial({
		vertexShader: MIST_VERT.replace(/DAMS/g, String(n)),
		fragmentShader: MIST_FRAG,
		uniforms: { uTime: shared.uTime, uMist: { value: mist }, uColor: { value: new THREE.Color(0xf4fbff) }, uPx: px },
		transparent: true,
		depthWrite: false,
	});
	const mistPoints = new THREE.Points(mGeom, mistMat);
	mistPoints.frustumCulled = false;
	mistPoints.renderOrder = 5;

	// Warm lights on crests and powerhouses, visible at night.
	const lPos = [];
	const lSeed = [];
	list.forEach((b) => {
		for (const p of dams.info.get(b.r.id).lights) {
			lPos.push(...p);
			lSeed.push(Math.random());
		}
	});
	const lGeom = new THREE.BufferGeometry();
	lGeom.setAttribute("position", new THREE.Float32BufferAttribute(lPos, 3));
	lGeom.setAttribute("aSeed", new THREE.Float32BufferAttribute(lSeed, 1));
	const lightOn = { value: 0 };
	const lights = new THREE.Points(lGeom, new THREE.ShaderMaterial({
		vertexShader: LIGHT_VERT,
		fragmentShader: LIGHT_FRAG,
		uniforms: { uTime: shared.uTime, uOn: lightOn, uPx: px },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	}));
	lights.frustumCulled = false;
	lights.renderOrder = 6;

	const group = new THREE.Group();
	group.add(ribbon, mistPoints, lights);

	// Half-width scale per kind for a release value.
	const widthFor = (kind, rel) => (kind === KIND.OUTFLOW ? 0.38 + 0.8 * rel : kind === KIND.INFLOW ? 0.3 + 0.25 * rel : kind === KIND.MAIN ? 0.7 + 0.9 * rel : 1);
	// Ground heights under each strip at five release levels. They are sampled in idle time
	// after the first frame; from then on a month change only interpolates between them
	// instead of re-sampling the terrain for every vertex, which used to cost a dropped
	// frame on every step of the drought replay.
	const LEVELS = [ 0, 0.25, 0.5, 0.75, 1 ];
	let groundSamples = 0;
	const pending = [];
	for (const st of strips) {
		if (st.kind === KIND.CHUTE) continue;
		const sample = st.sample;
		st.sample = (x, z, y) => {
			groundSamples++;
			return sample(x, z, y);
		};
		pending.push(st);
	}
	function fillLevels(st) {
		st.ys = LEVELS.map((rel) => {
			const k = widthFor(st.kind, rel) * BANK;
			const tmp = new Float32Array(st.rows * ACROSS.length * 3);
			placeStrip({ ...st, start: 0 }, st.centre, (i, d) => st.shape(i, d) * k, st.sample, tmp);
			const ys = new Float32Array(st.rows * ACROSS.length);
			for (let v = 0; v < ys.length; v++) ys[v] = tmp[v * 3 + 1];
			return ys;
		});
	}
	// Safari has no requestIdleCallback: fall back to short timer slices with a real budget.
	const idle = window.requestIdleCallback ?? ((fn) => setTimeout(() => {
		const t0 = performance.now();
		fn({ timeRemaining: () => 8 - (performance.now() - t0) });
	}, 50));
	const work = (deadline) => {
		while (pending.length && deadline.timeRemaining() > 2) fillLevels(pending.shift());
		if (pending.length) idle(work);
	};
	idle(work);
	function place(outlet, pos = positions) {
		for (const st of strips) {
			const rel = Math.min(1, Math.max(0, outlet[st.dam]));
			const k = widthFor(st.kind, rel);
			const bank = st.kind === KIND.CHUTE ? 1 : BANK;
			if (!st.ys) {
				placeStrip(st, st.centre, (i, d) => st.shape(i, d) * k * bank, st.sample, pos);
				continue;
			}
			const seg = Math.min(LEVELS.length - 2, Math.floor(rel * (LEVELS.length - 1)));
			const lo = st.ys[seg];
			const hi = st.ys[seg + 1];
			const t = rel * (LEVELS.length - 1) - seg;
			let local = 0;
			placeStrip(st, st.centre, (i, d) => st.shape(i, d) * k * bank, () => {
				const y = lo[local] + (hi[local] - lo[local]) * t;
				local++;
				return y;
			}, pos);
		}
	}
	place(new Array(n).fill(0.5));
	geom.attributes.position.needsUpdate = true;
	geom.computeBoundingSphere();
	// Second set of positions for the left half of the compare split, placed for that month.
	const mainAttr = geom.attributes.position;
	let compareAttr = null;
	let compareOutlet = null;

	// Points along both banks of every river, for riparian trees and boulders.
	function bankPoints(step = 1.1) {
		const pts = [];
		for (const st of strips) {
			if (st.kind === KIND.CHUTE || st.kind === KIND.MAIN) continue;
			const full = widthFor(st.kind, 1) * BANK;
			for (let i = 0; i < st.centre.length; i++) {
				const d = st.alongs[i];
				if (Math.floor(d / step) === Math.floor((st.alongs[i - 1] ?? -1) / step)) continue;
				const half = st.shape(i, d) * full;
				const [ sx, sz ] = st.frames[i];
				pts.push({ x: st.centre[i][0], z: st.centre[i][2], sx, sz, half, kind: st.kind, along: d });
			}
		}
		return pts;
	}

	// True when a point is on or beside a spillway chute.
	function nearChute(x, z, pad = 0.8) {
		for (const st of strips) {
			if (st.kind !== KIND.CHUTE) continue;
			const w = st.shape() + pad;
			for (const p of st.centre) if (Math.hypot(p[0] - x, p[2] - z) < w) return true;
		}
		return false;
	}

	return {
		group,
		lengths,
		// For tests: how each dam's river ends (river, stem, lake or fade) and the ground slope there.
		endings,
		// For tests: each strip's dam, kind, first and last centre point, lowest point and the
		// biggest step between neighbouring centre points (a gap in the line).
		// For tests: centre points of the main-stem ribbons.
		// Each dam's outflow centreline (for the flow pulses).
		outflowLines: () => strips.filter((st) => st.kind === KIND.OUTFLOW).map((st) => ({ dam: st.dam, pts: st.centre })),
		stemPoints: () => strips.filter((st) => st.kind === KIND.MAIN).flatMap((st) => st.centre.map((p) => [ p[0], p[2] ])),
		links: () => strips.filter((st) => st.kind !== KIND.CHUTE && st.kind !== KIND.MAIN).map((st) => {
			let gap = 0;
			let minY = Infinity;
			st.centre.forEach((p, i) => {
				if (i) gap = Math.max(gap, Math.hypot(p[0] - st.centre[i - 1][0], p[2] - st.centre[i - 1][2]));
				minY = Math.min(minY, p[1]);
			});
			// Lowest point of the line inside its own lake outline (Infinity if it never gets there).
			const own = list[st.dam];
			let inLake = Infinity;
			for (const p of st.centre) if (own.sOf(...own.toLocal(p[0], p[2])) < 1.05) inLake = Math.min(inLake, p[1]);
			// Sharpest turn along the line, between headings about 1.5 units apart (a hook or U-turn
			// shows as a turn near 180 degrees).
			let turn = 0;
			const c = st.centre;
			for (let i = 0, j = 0, k = 0; i < c.length; i++) {
				while (j < i && st.alongs[i] - st.alongs[j] > 1.5) j++;
				while (k < c.length - 1 && st.alongs[k] - st.alongs[i] < 1.5) k++;
				if (j === i || k === i) continue;
				const a = [ c[i][0] - c[j][0], c[i][2] - c[j][2] ];
				const b = [ c[k][0] - c[i][0], c[k][2] - c[i][2] ];
				const cos = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
				turn = Math.max(turn, Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
			}
			return { dam: st.dam, kind: st.kind, start: st.centre[0], end: st.centre[st.centre.length - 1], gap, minY, inLake, turn, weight: weightOf(own) };
		}),
		bankPoints,
		nearChute,
		router,
		// For tests: each end of every outflow and main-stem ribbon, and how far it is from any
		// other ribbon (a free end far from everything, not in a lake or at sea, looks cut off).
		ribbonEnds() {
			const rib = strips.filter((st) => st.kind === KIND.OUTFLOW || st.kind === KIND.MAIN);
			const res = [];
			rib.forEach((st, si) => {
				for (const [ which, p, tapered ] of [ [ "start", st.centre[0], st.taper[0] ], [ "end", st.centre[st.centre.length - 1], st.taper[1] ] ]) {
					let near = Infinity;
					let to = null;
					rib.forEach((o, oi) => {
						if (oi === si) return;
						for (const q of o.centre) {
							const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
							if (d < near) {
								near = d;
								to = o.name ?? list[o.dam].r.id;
							}
						}
					});
					res.push({ kind: st.kind === KIND.MAIN ? "main" : "outflow", name: st.name ?? list[st.dam].r.id, which, x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2), near: +near.toFixed(2), to, tapered, lake: Boolean(lakeAt(p[0], p[2], null, 1.6)), sea: atSea(p[0], p[2]) });
				}
			});
			return res;
		},
		// The drawn river below a dam as world [x, z] points from the dam toe, followed on into
		// the river it joins (another dam's outflow line), as far as the drawn lines go.
		riverPath(di) {
			const pts = [];
			const via = [];
			const seen = new Set();
			let i = di;
			let from = 0;
			while (i >= 0 && !seen.has(i) && outSeq[i] && outSeq[i].length > 2) {
				seen.add(i);
				if (i !== di) via.push(list[i].r.id);
				const seq = outSeq[i];
				for (let k = from; k < seq.length; k++) pts.push([ seq[k][0], seq[k][2] ]);
				const j = joins[i] ? list.findIndex((b) => b.r.id === joins[i]) : -1;
				if (j < 0 || !outSeq[j]) break;
				const [ ex, ez ] = pts[pts.length - 1];
				let best = 0;
				let bd = Infinity;
				outSeq[j].forEach((p, k) => {
					const d = Math.hypot(p[0] - ex, p[2] - ez);
					if (d < bd) {
						bd = d;
						best = k;
					}
				});
				i = j;
				from = best + 1;
			}
			const last = endings.find((e) => e.id === list[seen.size ? [ ...seen ].pop() : di].r.id);
			return { pts, via, ending: last ? last.ending : null };
		},
		// For tests: terrain samples taken so far while placing strips (a month change takes none).
		groundSamples: () => groundSamples,
		levelsReady: () => pending.length === 0,
		// Rebuild the strips on the ground for a month's release (called on month change).
		setWidths(outlet) {
			place(outlet);
			geom.attributes.position.needsUpdate = true;
		},
		compareState: () => ({ placed: compareOutlet !== null, mainBound: geom.attributes.position === mainAttr }),
		// Compare: draw with the left month's river widths (outlet array), or back to the main ones (null).
		useCompare(outlet) {
			if (!outlet) {
				geom.setAttribute("position", mainAttr);
				return;
			}
			if (!compareAttr) compareAttr = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
			if (outlet !== compareOutlet) {
				compareOutlet = outlet;
				place(outlet, compareAttr.array);
				compareAttr.needsUpdate = true;
			}
			geom.setAttribute("position", compareAttr);
		},
		// Current water surface per lake: inflows show only above it.
		setLevels(levels) {
			for (let i = 0; i < n; i++) levelU[i] = levels[i];
		},
		apply(outlet, spillNow) {
			for (let i = 0; i < n; i++) {
				release[i] = outlet[i];
				spill[i] = spillNow[i];
				mist[i] = Math.min(1, outlet[i] * 0.75 + spillNow[i] * 0.9);
			}
		},
		setNight(v) {
			night.value = v;
			lightOn.value = v;
			ribbonMat.uniforms.uWater.value.set(v > 0.5 ? 0x3f8fb8 : 0x2f7186);
			ribbonMat.uniforms.uBank.value.set(v > 0.5 ? 0x4a4a50 : 0x6e6352);
		},
		state: () => list.map((b, i) => ({
			id: b.r.id,
			width: release[i] > 0.001 && lengths[i] > 0 ? widthFor(KIND.OUTFLOW, release[i]) * scales[i] : 0,
			length: lengths[i],
			into: into[i],
			joins: joins[i],
			mist: mist[i],
			chuteSpill: strips.some((s) => s.dam === i && s.kind === KIND.CHUTE) ? spill[i] : null,
		})),
		// For tests: worst gap between drawn water and the ground, and worst climb along a path.
		verify() {
			let maxGap = 0;
			let maxClimb = 0;
			let worst = null;
			const P = positions;
			const cols = ACROSS.length;
			for (const st of strips) {
				if (st.kind === KIND.CHUTE) continue;
				for (let r = 0; r < st.rows; r++) {
					for (let c = 0; c < cols; c++) {
						const v = st.start + r * cols + c;
						const pts = [ [ P[v * 3], P[v * 3 + 1], P[v * 3 + 2] ] ];
						if (c < cols - 1) {
							// Midpoint of each cross-section segment, as the GPU draws it.
							const w = v + 1;
							pts.push([ (P[v * 3] + P[w * 3]) / 2, (P[v * 3 + 1] + P[w * 3 + 1]) / 2, (P[v * 3 + 2] + P[w * 3 + 2]) / 2 ]);
						}
						for (const [ x, y, z ] of pts) {
							const gap = Math.abs(y - (router.surface(x, z) + router.OFFSET));
							if (gap > maxGap) {
								maxGap = gap;
								worst = `${list[st.dam].r.id} ${[ "outflow", "inflow", "chute", "main stem" ][st.kind]} at ${x.toFixed(0)},${z.toFixed(0)}`;
							}
						}
					}
				}
				// Main stems follow mapped courses across the flat valley floor, not a computed descent.
				if (st.kind === KIND.MAIN) continue;
				let low = Infinity;
				for (const p of st.centre) {
					maxClimb = Math.max(maxClimb, p[1] - low);
					low = Math.min(low, p[1]);
				}
			}
			return { maxGap: +maxGap.toFixed(3), maxClimb: +Math.max(0, maxClimb).toFixed(3), worst, strips: strips.length };
		},
	};
}
