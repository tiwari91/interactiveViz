// Routing and geometry for water on the ground: outflow below each dam, inflow
// into each lake, and spillway chutes. Strips conform to the terrain at both
// edges (heights sampled per vertex, world-up frame, no twisting), and every
// ground path only ever runs downhill.
const STEP = 0.45;
const OFFSET = 0.12; // lift above the ground
const CLIMB_TOL = 0.45; // a path stops rather than climb more than this
const PULL = 8; // longest straight run string pulling may lay across a zigzag

export const KIND = { OUTFLOW: 0, INFLOW: 1, CHUTE: 2, MAIN: 3 };
export const CLIMB = CLIMB_TOL;
// Cross-section columns: both edges, the centre and two in between all sit on the ground.
export const ACROSS = [ -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1 ];

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

// Height of the ground the rivers are laid on: the carved basin surface, else the DEM.
export function groundSurface(basins, world) {
	return (x, z) => {
		const s = basins.surfaceAt(x, z);
		// Lake beds can sit below sea level (a deep bowl in the low foothills); only open ground
		// is held at the shore height.
		return s && s.zone === "bowl" ? s.h : Math.max(0.3, s ? s.h : world.groundY(x, z));
	};
}

export function createRouter(basins, world) {
	const surface = groundSurface(basins, world);

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
	// Smoothest first; if corner cutting lifts the line onto a canyon wall and it would have
	// to stop short, use less smoothing so the river still reaches its end.
	function drapeWith(seq0) {
		const seq = seq0.map(([ x, z ]) => [ x, surface(x, z) + OFFSET, z ]);
		let low = Infinity;
		let skipped = 0;
		const out = [];
		for (const p of seq) {
			// A single lifted corner is dropped (the strip runs straight past it).
			if (p[1] > low + CLIMB_TOL) {
				if (++skipped > 8) return { out, full: false };
				continue;
			}
			skipped = 0;
			low = Math.min(low, p[1]);
			out.push(p);
		}
		return { out, full: true };
	}
	// A walk that dithers in a hollow can double back over itself: cut out any loop (a point
	// that comes back near an earlier one) and any final back-and-forth, so the line never hooks.
	function untangle(pts) {
		const out = [];
		for (const p of pts) {
			let back = -1;
			for (let i = out.length - 2; i >= Math.max(0, out.length - 30); i--) {
				if (Math.hypot(out[i][0] - p[0], out[i][1] - p[1]) < STEP * (out.length - i > 3 ? 1.2 : 0.8)) {
					back = i;
					break;
				}
			}
			if (back >= 0) out.length = back + 1;
			else out.push(p);
		}
		// Cut across hairpins: where the line turns back by more than about 110 degrees over a
		// couple of steps, drop the points at the bend so it runs through as one curve.
		for (let pass = 0; pass < 80; pass++) {
			let cut = -1;
			for (let i = 2; i < out.length - 2 && cut < 0; i++) {
				for (const k of [ 2, 3, 4 ]) {
					if (i < k || i + k >= out.length) continue;
					const a = [ out[i][0] - out[i - k][0], out[i][1] - out[i - k][1] ];
					const b = [ out[i + k][0] - out[i][0], out[i + k][1] - out[i][1] ];
					const cos = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
					if (cos < -0.34) {
						cut = i;
						break;
					}
				}
			}
			if (cut < 0) break;
			out.splice(cut, 1);
		}
		// Trim a tail that turns back sharply on the way it came.
		for (let pops = 0; pops < 6 && out.length > 4; pops++) {
			const n = out.length;
			const a = [ out[n - 2][0] - out[n - 4][0], out[n - 2][1] - out[n - 4][1] ];
			const b = [ out[n - 1][0] - out[n - 2][0], out[n - 1][1] - out[n - 2][1] ];
			const cos = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
			if (cos > -0.5) break;
			out.pop();
		}
		return out;
	}

	function drape(pts) {
		pts = untangle(pts);
		let best = null;
		for (const cand of [ chaikin(chaikin(pts)), chaikin(pts), pts ]) {
			const r = drapeWith(cand);
			if (r.full) return r.out;
			const len = r.out.length / cand.length;
			if (!best || len > best.len) best = { out: r.out, len };
		}
		return best.out;
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
			// A river that joins another never fades out at its end.
			out.meta.push(meta.dam, meta.kind, meta.joins ? total + 1000 : total, meta.weight ?? 0);
			if (out.dir) out.dir.push(-tz / tl, tx / tl);
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

// Smooth a laid-out course ([x, y, z] points) at the scale of the elevation grid, so a path traced
// cell by cell over the DEM runs in easy curves instead of stair-steps and square corners, and a
// straight lead-in or link blends into the course it meets. Both ends stay where they are.
// heightAt(x, z) gives the centreline height on the ground. With a climb limit, any stretch the
// smoothing would lift up a valley side is eased back toward the traced line until the course
// again never climbs more than that. alpha0 (per point, 0..1) limits where it may move at all.
export function smoothCourse(seq, heightAt, { radius = 1.5, passes = 3, spacing = 0.3, climb = null, alpha0 = null } = {}) {
	if (seq.length < 3) return seq;
	// Resample evenly along the line (index-aligned original and smoothed copies).
	const along = [ 0 ];
	for (let i = 1; i < seq.length; i++) along.push(along[i - 1] + Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][2] - seq[i - 1][2]));
	const total = along[along.length - 1];
	if (total < spacing * 3) return seq;
	// A course that ends back near where it began (a walk that circled in a hollow) is left as it
	// is: smoothing would draw the loop in on itself.
	if (Math.hypot(seq[seq.length - 1][0] - seq[0][0], seq[seq.length - 1][2] - seq[0][2]) < 3) return seq;
	const n = Math.max(3, Math.round(total / spacing) + 1);
	const orig = [];
	const a0 = [];
	for (let k = 0, j = 0; k < n; k++) {
		const d = total * k / (n - 1);
		while (j < seq.length - 2 && along[j + 1] < d) j++;
		const t = Math.min(1, Math.max(0, (d - along[j]) / ((along[j + 1] - along[j]) || 1)));
		const p = seq[j];
		const q = seq[j + 1];
		orig.push([ p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t ]);
		a0.push(alpha0 ? alpha0[j] + (alpha0[j + 1] - alpha0[j]) * t : 1);
	}
	// Pull the string first: where the traced line zigzags round a hollow or a low rise, run straight
	// across instead, wherever that straight run stays as low as the line it replaces.
	if (climb !== null) pull(orig, a0, heightAt, climb, Math.round(PULL / (total / (n - 1))));
	// Repeated centred moving average.
	const step = total / (n - 1);
	const average = (r) => {
		const K = Math.max(1, Math.round(r / step));
		let sm = orig.map((p) => [ p[0], p[2] ]);
		for (let pass = 0; pass < passes; pass++) {
			const prev = sm;
			// Past each end the line is mirrored through the end point, which so stays put while the
			// points next to it are smoothed as fully as any other.
			const get = (j) => {
				if (j < 0) {
					const q = prev[Math.min(n - 1, -j)];
					return [ 2 * prev[0][0] - q[0], 2 * prev[0][1] - q[1] ];
				}
				if (j > n - 1) {
					const q = prev[Math.max(0, 2 * (n - 1) - j)];
					return [ 2 * prev[n - 1][0] - q[0], 2 * prev[n - 1][1] - q[1] ];
				}
				return prev[j];
			};
			sm = prev.map((p, i) => {
				if (i === 0 || i === n - 1) return p;
				let sx = 0;
				let sz = 0;
				for (let m = -K; m <= K; m++) {
					const q = get(i + m);
					sx += q[0];
					sz += q[1];
				}
				return [ sx / (2 * K + 1), sz / (2 * K + 1) ];
			});
		}
		return sm;
	};
	// Coarse to fine: where the smoothest line would climb a valley side, it eases (continuously)
	// toward a less smoothed one, and last of all to the traced line.
	const levels = [ average(radius) ];
	if (climb !== null) levels.push(average(radius / 2), average(radius / 4), orig.map((p) => [ p[0], p[2] ]));
	const top = levels.length - 1;
	const lvl = new Float32Array(n);
	const at = (i) => {
		const a = a0[i];
		const t = lvl[i];
		if (a <= 0 || (top > 0 && t >= top)) return orig[i];
		const f = Math.floor(t);
		const u = t - f;
		const A = levels[f][i];
		const B = levels[Math.min(top, f + 1)][i];
		const x = orig[i][0] + (A[0] + (B[0] - A[0]) * u - orig[i][0]) * a;
		const z = orig[i][2] + (A[1] + (B[1] - A[1]) * u - orig[i][2]) * a;
		return [ x, heightAt(x, z), z ];
	};
	const out = orig.map((_, i) => at(i));
	if (climb === null) return out;
	const K = Math.max(1, Math.round(radius / step));
	// Points where the traced line itself rises (within the router's own tolerance) stand as they are.
	const accepted = new Set();
	for (let iter = 0; iter < 4000; iter++) {
		let low = Infinity;
		let lowAt = 0;
		let bad = -1;
		for (let i = 0; i < n; i++) {
			if (out[i][1] > low + climb && !accepted.has(i)) {
				bad = i;
				break;
			}
			if (out[i][1] < low) {
				low = out[i][1];
				lowAt = i;
			}
		}
		if (bad < 0) break;
		// Ease toward the finer line around the offending point (and the stretch before it, where
		// the line came down), tapering off either side so the line stays smooth.
		let moved = false;
		for (let i = Math.max(0, bad - 4 * K); i <= Math.min(n - 1, bad + 2 * K); i++) {
			if (lvl[i] >= top) continue;
			const d = i < bad ? (bad - i) / (4 * K) : (i - bad) / (2 * K);
			lvl[i] = Math.min(top, lvl[i] + 0.25 * Math.min(1, 1.5 * (1 - d)));
			out[i] = at(i);
			moved = true;
		}
		if (!moved || lvl[bad] >= top) {
			// The traced line itself is all that is left here: ease back the stretch from the low point.
			let any = false;
			for (let i = lowAt; i < bad; i++) {
				if (lvl[i] >= top) continue;
				lvl[i] = top;
				out[i] = at(i);
				any = true;
			}
			if (!any) accepted.add(bad);
		}
	}
	return out;
}

// String pulling for smoothCourse (in place on the evenly spaced points): replace a stretch i..j by
// the straight run between its ends when that run is shorter, never rises more than the climb
// limit above the low point reached so far, and never dips below the stretch's own lowest point
// (so nothing after it newly counts as climbing).
function pull(pts, a0, heightAt, climb, M) {
	const n = pts.length;
	const step = Math.hypot(pts[1][0] - pts[0][0], pts[1][2] - pts[0][2]) || 0.3;
	// Chord i..j stays within the climb limit above the low so far, and no lower than the stretch.
	const chordOk = (i, j, low) => {
		let lowIJ = Infinity;
		for (let k = i; k <= j; k++) lowIJ = Math.min(lowIJ, pts[k][1]);
		for (let k = i + 1; k < j; k++) {
			if (a0[k] < 1) return false;
			const t = (k - i) / (j - i);
			const h = heightAt(pts[i][0] + (pts[j][0] - pts[i][0]) * t, pts[i][2] + (pts[j][2] - pts[i][2]) * t);
			if (h > Math.min(low, lowIJ) + climb || h < lowIJ - 0.01) return false;
		}
		return a0[i] === 1 && a0[j] === 1;
	};
	const lay = (i, j) => {
		const [ ax, , az ] = pts[i];
		const [ bx, , bz ] = pts[j];
		for (let k = i + 1; k < j; k++) {
			const t = (k - i) / (j - i);
			const x = ax + (bx - ax) * t;
			const z = az + (bz - az) * t;
			pts[k] = [ x, heightAt(x, z), z ];
		}
	};
	// Loops first: where the line wanders off and comes back near itself (an overshoot on a flat
	// valley floor), cut straight across the neck.
	{
		let low = pts[0][1];
		const far = Math.round(20 / step);
		for (let i = 0; i < n - 2; i++) {
			low = Math.min(low, pts[i][1]);
			// Not right at the head: the river leaves the dam the way it shows.
			if (i * step < 4) continue;
			for (let j = Math.min(n - 1, i + far); j > i + Math.round(2 / step); j--) {
				const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][2] - pts[i][2]);
				if (d > 4 || d * 2.5 > (j - i) * step) continue;
				if (!chordOk(i, j, low)) continue;
				lay(i, j);
				for (let k = i; k <= j; k++) low = Math.min(low, pts[k][1]);
				i = j - 1;
				break;
			}
		}
	}
	let low = pts[0][1];
	for (let i = 0; i < n - 2; ) {
		let best = -1;
		let lowIJ = pts[i][1];
		let path = 0;
		for (let j = i + 1; j < Math.min(n, i + M + 1); j++) {
			lowIJ = Math.min(lowIJ, pts[j][1]);
			path += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][2] - pts[j - 1][2]);
			if (a0[j] < 1 || a0[i] < 1) break;
			if (j < i + 2) continue;
			const chord = Math.hypot(pts[j][0] - pts[i][0], pts[j][2] - pts[i][2]);
			if (path < chord * 1.03) continue;
			let ok = true;
			for (let k = i + 1; k < j && ok; k++) {
				const t = (k - i) / (j - i);
				const x = pts[i][0] + (pts[j][0] - pts[i][0]) * t;
				const z = pts[i][2] + (pts[j][2] - pts[i][2]) * t;
				const h = heightAt(x, z);
				if (h > Math.min(low, lowIJ) + climb || h < lowIJ - 0.01) ok = false;
			}
			if (ok) best = j;
		}
		if (best > 0) {
			const [ ax, , az ] = pts[i];
			const [ bx, , bz ] = pts[best];
			for (let k = i + 1; k < best; k++) {
				const t = (k - i) / (best - i);
				const x = ax + (bx - ax) * t;
				const z = az + (bz - az) * t;
				pts[k] = [ x, heightAt(x, z), z ];
			}
			for (let k = i; k <= best; k++) low = Math.min(low, pts[k][1]);
			i = best;
		} else {
			i++;
			low = Math.min(low, pts[i][1]);
		}
	}
}
