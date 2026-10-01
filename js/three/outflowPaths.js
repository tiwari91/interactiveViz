// Routing and geometry for water on the ground: outflow below each dam, inflow
// into each lake, and spillway chutes. Strips conform to the terrain at both
// edges (heights sampled per vertex, world-up frame, no twisting), and every
// ground path only ever runs downhill.
const STEP = 0.45;
const OFFSET = 0.12; // lift above the ground
const CLIMB_TOL = 0.45; // a path stops rather than climb more than this

export const KIND = { OUTFLOW: 0, INFLOW: 1, CHUTE: 2 };
export const CLIMB = CLIMB_TOL;
// Cross-section columns: both edges, the centre and two in between all sit on the ground.
export const ACROSS = [ -1, -0.5, 0, 0.5, 1 ];

// Corner cutting keeps curves smooth.
function chaikin(p) {
	if (p.length < 3) return p;
	const out = [ p[0] ];
	for (let i = 0; i < p.length - 1; i++) {
		const [ ax, az ] = p[i];
		const [ bx, bz ] = p[i + 1];
		out.push([ ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25 ], [ ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75 ]);
	}
	out.push(p[p.length - 1]);
	return out;
}

export function createRouter(basins, world) {
	const surface = (x, z) => {
		const s = basins.surfaceAt(x, z);
		return Math.max(0.3, s ? s.h : world.groundY(x, z));
	};

	// Steepest descent with momentum; stops at a pit, when it would climb, at the
	// length limit, or (inflow) when it reaches the lake.
	function downhill(start, heading, maxLen, opts = {}) {
		const pts = [ start ];
		let [ hx, hz ] = heading;
		const [ d0x, d0z ] = heading;
		let lowest = surface(...start);
		for (let walked = 0; walked < maxLen; walked += STEP) {
			const [ px, pz ] = pts[pts.length - 1];
			if (opts.into) {
				const [ u, v ] = opts.into.toLocal(px, pz);
				if (opts.into.sOf(u, v) < 0.8) break;
			}
			if (opts.avoid) {
				// Never run back over the dam or the lake it holds.
				const [ u, v ] = opts.avoid.toLocal(px, pz);
				if (u > opts.avoid.dam.u - 0.3 && opts.avoid.sOf(u, v) < 1.3) break;
			}
			let best = null;
			for (let a = -1.2; a <= 1.2001; a += 0.2) {
				const dx = hx * Math.cos(a) - hz * Math.sin(a);
				const dz = hx * Math.sin(a) + hz * Math.cos(a);
				const g = surface(px + dx * STEP * 2, pz + dz * STEP * 2) + Math.abs(a) * 0.03;
				if (!best || g < best.g) best = { g, dx, dz };
			}
			hx = hx * 0.55 + best.dx * 0.45;
			hz = hz * 0.55 + best.dz * 0.45;
			if (opts.into) {
				const cx = opts.into.cx - px;
				const cz = opts.into.cz - pz;
				const cl = Math.hypot(cx, cz) || 1;
				hx = hx * 0.8 + (cx / cl) * 0.2;
				hz = hz * 0.8 + (cz / cl) * 0.2;
			} else if (hx * d0x + hz * d0z < 0.26) {
				hx = hx * 0.5 + d0x * 0.5;
				hz = hz * 0.5 + d0z * 0.5;
			}
			const l = Math.hypot(hx, hz);
			hx /= l;
			hz /= l;
			let next = [ px + hx * STEP, pz + hz * STEP ];
			let g = surface(...next);
			if (g > lowest + CLIMB_TOL) {
				// Blocked: look round more widely for any way that does not climb.
				let alt = null;
				for (let a = -2.4; a <= 2.4001; a += 0.3) {
					const dx = d0x * Math.cos(a) - d0z * Math.sin(a);
					const dz = d0x * Math.sin(a) + d0z * Math.cos(a);
					if (dx * d0x + dz * d0z < (opts.into ? -1 : -0.2)) continue;
					const q = [ px + dx * STEP, pz + dz * STEP ];
					const gq = surface(...q);
					if (gq <= lowest + CLIMB_TOL && (!alt || gq < alt.g)) alt = { q, g: gq, dx, dz };
				}
				if (!alt) break;
				next = alt.q;
				g = alt.g;
				hx = alt.dx;
				hz = alt.dz;
			}
			lowest = Math.min(lowest, g);
			pts.push(next);
		}
		return pts;
	}

	// Ground path -> centreline heights that never rise (beyond tolerance) along the flow.
	function drape(pts) {
		const seq = chaikin(chaikin(pts)).map(([ x, z ]) => [ x, surface(x, z) + OFFSET, z ]);
		let low = Infinity;
		const out = [];
		for (const p of seq) {
			if (p[1] > low + CLIMB_TOL) break; // smoothing pushed it uphill: stop here
			low = Math.min(low, p[1]);
			out.push(p);
		}
		return out;
	}

	return { surface, downhill, drape, OFFSET, STEP };
}

// Topology for a strip: rows along the path, ACROSS columns per row. Positions
// are filled in by placeStrip() for the current width, sampled on the ground.
export function stripGeometry(seq, out, meta) {
	const cols = ACROSS.length;
	const base = out.count;
	let dist = 0;
	const frames = [];
	const total = seq.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - seq[i - 1][0], p[2] - seq[i - 1][2]) : 0), 0);
	seq.forEach((p, i) => {
		const a = seq[Math.max(0, i - 1)];
		const c = seq[Math.min(seq.length - 1, i + 1)];
		const tx = c[0] - a[0];
		const tz = c[2] - a[2];
		const tl = Math.hypot(tx, tz) || 1;
		// World-up frame: the side vector is horizontal, so the strip cannot twist.
		frames.push([ -tz / tl, tx / tl ]);
		if (i > 0) dist += Math.hypot(p[0] - a[0], p[2] - a[2]);
		for (const s of ACROSS) {
			out.side.push(s);
			out.along.push(dist);
			out.meta.push(meta.dam, meta.kind, total, 0);
		}
		if (i > 0) {
			for (let k = 0; k < cols - 1; k++) {
				const o = base + (i - 1) * cols + k;
				out.index.push(o, o + cols, o + 1, o + 1, o + cols, o + cols + 1);
			}
		}
	});
	out.count += seq.length * cols;
	const alongs = [];
	let d = 0;
	seq.forEach((p, i) => {
		if (i > 0) d += Math.hypot(p[0] - seq[i - 1][0], p[2] - seq[i - 1][2]);
		alongs.push(d);
	});
	return { start: base, rows: seq.length, length: total, frames, alongs };
}

// Write positions for a strip at the given half-width function.
export function placeStrip(st, seq, half, sampleY, pos) {
	let v = st.start;
	seq.forEach((p, i) => {
		const h = half(i, st.alongs[i]);
		const [ sx, sz ] = st.frames[i];
		for (const s of ACROSS) {
			const x = p[0] + sx * h * s;
			const z = p[2] + sz * h * s;
			pos[v * 3] = x;
			pos[v * 3 + 1] = sampleY(x, z, p[1]);
			pos[v * 3 + 2] = z;
			v++;
		}
	});
}
