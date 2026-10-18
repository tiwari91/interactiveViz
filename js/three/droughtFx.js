// Drought animations in the 3D view, all driven by js/drought.js (the reservoirs' own storage):
//  - the dry front: a sand wash spreading round reservoirs far below their average, with a
//    shimmering leading edge (terrain shader) and a few drifting dust motes; a teal refill front
//    spreads back from refilling lakes in wet months;
//  - flares: a brief pulse with expanding rings on a reservoir the month it drops below 40% full
//    (amber) or reaches its record low (teal); at most three at once;
//  - the dated drought path: a dashed ink line drawing itself from stop to stop, each stop the
//    driest large reservoir of a March or September, with a date label.
// Under reduced motion nothing animates: fronts and the path change in one step, no dust, no flares.
import { frontAt, flaresAt, recordLows, droughtPaths, pathProgress, stopLabel, shortName } from "../drought.js";

const N = 128; // field texels across the 1000-unit world
const FRONT_MS = 1600;
const FLARE_MS = 2200;
const MAX_FLARES = 3;

const DUST_VERT = `
	attribute float aAlpha;
	uniform float uPx;
	varying float vA;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vA = aAlpha;
		gl_PointSize = uPx * clamp(60.0 / -mv.z, 1.2, 5.0);
		gl_Position = projectionMatrix * mv;
	}`;
const DUST_FRAG = `
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - 0.5;
		float d = dot(c, c) * 4.0;
		if (d > 1.0 || vA < 0.01) discard;
		gl_FragColor = vec4(uColor, (1.0 - d) * vA);
	}`;
// The path is a fixed width on screen, not in the world: a world-width ribbon turned into a row of
// black slabs when the camera came down close to it.
const PATH_VERT = `
	attribute float aAlong;
	attribute float aSide;
	attribute vec3 aNext;
	uniform vec2 uRes;
	uniform float uWidth;
	varying float vAlong;
	void main() {
		vAlong = aAlong;
		vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		vec4 n = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
		vec2 a = c.xy / max(c.w, 1e-4) * uRes;
		vec2 b = n.xy / max(n.w, 1e-4) * uRes;
		vec2 d = b - a;
		d = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
		vec2 off = vec2(-d.y, d.x) * aSide * uWidth / uRes;
		gl_Position = c + vec4(off * c.w, 0.0, 0.0);
	}`;
const PATH_FRAG = `
	uniform vec3 uColor;
	uniform float uA;
	varying float vAlong;
	void main() {
		if (fract(vAlong * 0.22) > 0.62) discard;
		gl_FragColor = vec4(uColor, uA);
	}`;

export function createDroughtFx(THREE, { data, basins, world, container, labels, groundLocal, vScale, terrain, shared, quality, reduced, layer }) {
	const bIdx = new Map(basins.basins.map((b, k) => [ b.r.id, k ]));
	const nB = basins.basins.length;
	// ---------- Dry and refill fronts ----------
	const mk = () => {
		const buf = new Uint8Array(N * N * 4);
		for (let k = 0; k < N * N; k++) buf[k * 4] = buf[k * 4 + 2] = 0;
		const tex = new THREE.DataTexture(buf, N, N, THREE.RGBAFormat);
		tex.magFilter = tex.minFilter = THREE.LinearFilter;
		tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.needsUpdate = true;
		return { buf, tex };
	};
	const A = mk();
	const B = mk();
	const U = terrain.uniforms;
	U.uFrontA.value = A.tex;
	U.uFrontB.value = B.tex;
	U.uFTime = shared.uTime;
	U.uFrontOn.value = 1;
	let mixT = 1;
	const R = { dryFrom: new Float32Array(nB), dryTo: new Float32Array(nB), wetFrom: new Float32Array(nB), wetTo: new Float32Array(nB), dry: new Float32Array(nB) };
	const curR = (from, to, k, m) => from[k] + (to[k] - from[k]) * m;
	const ease = (t) => t * t * (3 - 2 * t);
	let stats = { dry: 0, wet: 0, dryIds: [], wetIds: [] };

	function field(entries, out) {
		// Signed distance per channel: 1 at the reservoir, 0 at the front, -1 a radius beyond it;
		// the strength (G, A) comes from the reservoir nearest to the front at that texel.
		const ds = new Float32Array(N * N).fill(-1);
		const ws = new Float32Array(N * N).fill(-1);
		const di = new Float32Array(N * N);
		const wi = new Float32Array(N * N);
		for (const e of entries) {
			const b = basins.byId.get(e.r.id);
			if (!b) continue;
			for (const [ km, sArr, iArr, v ] of [ [ e.dryKm, ds, di, e.dry ], [ e.wetKm, ws, wi, e.wet ] ]) {
				if (!km) continue;
				const rad = km * world.unitsPerKm;
				const reach = rad * 2;
				const u0 = Math.max(0, Math.floor((b.cx - reach + 500) / 1000 * N));
				const u1 = Math.min(N - 1, Math.ceil((b.cx + reach + 500) / 1000 * N));
				const v0 = Math.max(0, Math.floor((b.cz - reach + 500) / 1000 * N));
				const v1 = Math.min(N - 1, Math.ceil((b.cz + reach + 500) / 1000 * N));
				for (let y = v0; y <= v1; y++) {
					const z = (y + 0.5) / N * 1000 - 500;
					for (let x = u0; x <= u1; x++) {
						const s = 1 - Math.hypot((x + 0.5) / N * 1000 - 500 - b.cx, z - b.cz) / rad;
						const k = y * N + x;
						if (s > sArr[k]) {
							sArr[k] = Math.max(-1, s);
							iArr[k] = v;
						}
					}
				}
			}
		}
		let dry = 0;
		let wet = 0;
		for (let k = 0; k < N * N; k++) {
			out[k * 4] = Math.round((Math.min(1, ds[k]) + 1) * 127.5);
			out[k * 4 + 1] = Math.round(di[k] * 255);
			out[k * 4 + 2] = Math.round((Math.min(1, ws[k]) + 1) * 127.5);
			out[k * 4 + 3] = Math.round(wi[k] * 255);
			if (ds[k] > 0) dry++;
			if (ws[k] > 0) wet++;
		}
		return { dry, wet };
	}

	function setFront(i) {
		const m = ease(Math.min(1, mixT));
		// The field as drawn right now becomes the start of the next tween.
		for (let k = 0; k < A.buf.length; k++) A.buf[k] = Math.round(A.buf[k] + (B.buf[k] - A.buf[k]) * m);
		for (let k = 0; k < nB; k++) {
			R.dryFrom[k] = curR(R.dryFrom, R.dryTo, k, m);
			R.wetFrom[k] = curR(R.wetFrom, R.wetTo, k, m);
			R.dryTo[k] = 0;
			R.wetTo[k] = 0;
			R.dry[k] = 0;
		}
		const entries = frontAt(data, i);
		for (const e of entries) {
			const k = bIdx.get(e.r.id);
			if (k === undefined) continue;
			R.dryTo[k] = e.dryKm * world.unitsPerKm;
			R.wetTo[k] = e.wetKm * world.unitsPerKm;
			R.dry[k] = e.dry;
		}
		const c = field(entries, B.buf);
		const km2 = (1000 / N / world.unitsPerKm) ** 2;
		stats = { dry: Math.round(c.dry * km2), wet: Math.round(c.wet * km2), dryIds: entries.filter((e) => e.dry > 0).map((e) => e.r.id), wetIds: entries.filter((e) => e.wet > 0).map((e) => e.r.id) };
		A.tex.needsUpdate = true;
		B.tex.needsUpdate = true;
		mixT = reduced() ? 1 : 0;
	}

	// ---------- Dust motes at the dry front's edge ----------
	const NDUST = quality === "low" ? 18 : 36;
	const dPos = new Float32Array(NDUST * 3);
	const dAlpha = new Float32Array(NDUST);
	const dust = Array.from({ length: NDUST }, () => ({ age: 1, life: 0, vx: 0, vz: 0 }));
	const dGeom = new THREE.BufferGeometry();
	dGeom.setAttribute("position", new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
	dGeom.setAttribute("aAlpha", new THREE.BufferAttribute(dAlpha, 1).setUsage(THREE.DynamicDrawUsage));
	const dMat = new THREE.ShaderMaterial({
		vertexShader: DUST_VERT,
		fragmentShader: DUST_FRAG,
		uniforms: { uPx: { value: Math.min(2, window.devicePixelRatio || 1) }, uColor: { value: new THREE.Color("#e7c98f") } },
		transparent: true,
		depthWrite: false,
	});
	const dustPts = new THREE.Points(dGeom, dMat);
	dustPts.frustumCulled = false;
	dustPts.renderOrder = 3;
	let dustLive = 0;
	function stepDust(dt, m) {
		dustLive = 0;
		const on = layer.front && !reduced();
		dustPts.visible = on;
		if (!on) return;
		let total = 0;
		for (let k = 0; k < nB; k++) total += R.dry[k] * (curR(R.dryFrom, R.dryTo, k, m) > 1 ? 1 : 0);
		for (const p of dust) {
			p.age += dt;
			if (p.age >= p.life && total > 0 && Math.random() < dt * 6) {
				// Respawn on a dry front's edge, picked by how dry that reservoir is.
				let pick = Math.random() * total;
				let k = 0;
				for (; k < nB; k++) {
					const w = R.dry[k] * (curR(R.dryFrom, R.dryTo, k, m) > 1 ? 1 : 0);
					if (pick < w) break;
					pick -= w;
				}
				if (k >= nB) continue;
				const b = basins.basins[k];
				const rad = curR(R.dryFrom, R.dryTo, k, m);
				const a = Math.random() * Math.PI * 2;
				p.x = b.cx + Math.cos(a) * rad;
				p.z = b.cz + Math.sin(a) * rad;
				p.y = groundLocal(p.x, p.z) + 0.4;
				p.vx = Math.cos(a) * 0.9;
				p.vz = Math.sin(a) * 0.9;
				p.age = 0;
				p.life = 2.2 + Math.random() * 1.6;
			}
		}
		dust.forEach((p, j) => {
			if (p.age >= p.life) {
				dAlpha[j] = 0;
				return;
			}
			p.x += p.vx * dt;
			p.z += p.vz * dt;
			p.y += 0.5 * dt / vScale();
			dPos[j * 3] = p.x;
			dPos[j * 3 + 1] = p.y;
			dPos[j * 3 + 2] = p.z;
			dAlpha[j] = Math.sin(Math.PI * p.age / p.life) * 0.8;
			dustLive++;
		});
		dGeom.attributes.position.needsUpdate = true;
		dGeom.attributes.aAlpha.needsUpdate = true;
	}

	// ---------- Flares ----------
	const records = recordLows(data);
	const flareLayer = document.createElement("div");
	flareLayer.className = "flares-3d";
	flareLayer.setAttribute("aria-hidden", "true");
	container.appendChild(flareLayer);
	const slots = Array.from({ length: MAX_FLARES }, () => {
		const el = document.createElement("div");
		el.className = "flare";
		el.innerHTML = "<span class=\"flare-core\"></span><span class=\"flare-ring\"></span><span class=\"flare-ring\"></span><span class=\"flare-ring\"></span><span class=\"flare-text\"></span>";
		flareLayer.appendChild(el);
		return { el, f: null, t0: 0 };
	});
	let queue = [];
	const fired = [];
	function triggerFlares(i, fast) {
		if (reduced()) return;
		// During play only this month's flares wait; older ones are dropped.
		const list = flaresAt(data, i, records).filter((f) => bIdx.has(f.r.id)).map((f) => ({ ...f, i }));
		// A month picked by hand clears what was playing; during play, older flares finish but
		// older queued ones are dropped, so the cap holds even at full speed.
		if (!fast) {
			for (const s of slots) {
				s.f = null;
				s.el.classList.remove("on");
			}
		}
		queue = list.slice(0, MAX_FLARES * 2);
		startFlares(performance.now());
	}
	function startFlares(now) {
		for (const s of slots) {
			if (s.f || !queue.length) continue;
			const f = queue.shift();
			s.f = f;
			s.t0 = now;
			s.el.dataset.id = f.r.id;
			s.el.className = `flare flare-${f.kind}`;
			s.el.lastChild.textContent = f.kind === "cross" ? `${shortName(f.r.name)} below 40%` : "";
			void s.el.offsetWidth;
			s.el.classList.add("on");
			fired.push({ id: f.r.id, kind: f.kind, month: data.months[f.i], at: now });
			if (fired.length > 200) fired.shift();
		}
	}
	const v = new THREE.Vector3();
	function placeFlares(now, camera) {
		for (const s of slots) {
			if (!s.f) continue;
			if (now - s.t0 > FLARE_MS || reduced()) {
				s.f = null;
				s.el.classList.remove("on");
				continue;
			}
			const b = basins.byId.get(s.f.r.id);
			v.set(b.cx, b.levelFor(0.3) * vScale(), b.cz).project(camera);
			const off = v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
			s.el.style.visibility = off ? "hidden" : "";
			s.el.style.transform = `translate(${((v.x + 1) / 2 * container.clientWidth).toFixed(1)}px, ${((1 - v.y) / 2 * container.clientHeight).toFixed(1)}px)`;
		}
		startFlares(now);
	}

	// ---------- Dated drought path ----------
	const paths = droughtPaths(data).map((p) => {
		const pts = p.stops.map((s) => {
			const b = basins.byId.get(s.r.id);
			return new THREE.Vector3(b.cx, 0, b.cz);
		});
		const SEG = 40;
		const curve = pts.length > 1 ? new THREE.CatmullRomCurve3(pts, false, "centripetal") : null;
		const n = curve ? (pts.length - 1) * SEG + 1 : 1;
		const samples = curve ? curve.getSpacedPoints(n - 1) : pts;
		// Per sample: its stop progress (k + fraction), so the drawn part can be cut at any month.
		const along = [];
		const prog = [];
		let acc = 0;
		samples.forEach((q, j) => {
			if (j) acc += q.distanceTo(samples[j - 1]);
			along.push(acc);
		});
		// Stop progress from arc length between the stops' nearest samples.
		const stopAt = pts.map((q) => samples.reduce((best, s2, j) => (s2.distanceTo(q) < samples[best].distanceTo(q) ? j : best), 0));
		samples.forEach((_, j) => {
			let k = 0;
			while (k < stopAt.length - 2 && j > stopAt[k + 1]) k++;
			const a = stopAt[k];
			const z = stopAt[Math.min(stopAt.length - 1, k + 1)];
			prog.push(z > a ? k + Math.min(1, Math.max(0, (j - a) / (z - a))) : k);
		});
		const W = 1.5;
		const ys = samples.map((q, j) => {
			const a = samples[Math.max(0, j - 1)];
			const c = samples[Math.min(samples.length - 1, j + 1)];
			let dx = c.x - a.x;
			let dz = c.z - a.z;
			const l = Math.hypot(dx, dz) || 1;
			dx /= l;
			dz /= l;
			return Math.max(groundLocal(q.x, q.z), groundLocal(q.x - dz * W, q.z + dx * W), groundLocal(q.x + dz * W, q.z - dx * W)) + 1.4;
		});
		// Both edge vertices sit on the centre line; the shader pushes them apart on screen along
		// the perpendicular of the direction to the next sample (the previous one, reversed, at the end).
		const pos = new Float32Array(samples.length * 6);
		const nxt = new Float32Array(samples.length * 6);
		const side = new Float32Array(samples.length * 2);
		const al = new Float32Array(samples.length * 2);
		const last = samples.length - 1;
		samples.forEach((q, j) => {
			const o = samples[j < last ? j + 1 : Math.max(0, j - 1)];
			const oy = ys[j < last ? j + 1 : Math.max(0, j - 1)];
			const flip = j < last ? 1 : -1;
			pos.set([ q.x, ys[j], q.z, q.x, ys[j], q.z ], j * 6);
			nxt.set([ o.x, oy, o.z, o.x, oy, o.z ], j * 6);
			side[j * 2] = flip;
			side[j * 2 + 1] = -flip;
			al[j * 2] = al[j * 2 + 1] = along[j];
		});
		const index = [];
		for (let j = 0; j < samples.length - 1; j++) index.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
		const geom = new THREE.BufferGeometry();
		geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		geom.setAttribute("aAlong", new THREE.BufferAttribute(al, 1));
		geom.setAttribute("aNext", new THREE.BufferAttribute(nxt, 3));
		geom.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
		geom.setIndex(index);
		geom.setDrawRange(0, 0);
		const mat = new THREE.ShaderMaterial({
			vertexShader: PATH_VERT,
			fragmentShader: PATH_FRAG,
			uniforms: { uColor: { value: new THREE.Color("#152c47") }, uA: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.6 } },
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(geom, mat);
		mesh.renderOrder = 5;
		mesh.frustumCulled = false;
		const els = p.stops.map((s) => {
			const el = document.createElement("div");
			el.className = "dpath-stop";
			el.dataset.id = s.r.id;
			el.dataset.month = s.month;
			el.innerHTML = `<span class="dpath-dot"></span><span class="dpath-text">${stopLabel(s)}</span>`;
			flareLayer.appendChild(el);
			return el;
		});
		return { ...p, mesh, prog, els, alpha: 0, drawn: 0, sampleCount: samples.length };
	});
	const pathGroup = new THREE.Group();
	paths.forEach((p) => pathGroup.add(p.mesh));
	let curF = 0;
	let dimmed = new Set();
	let targetI = 0;
	function stepPath(dt, camera) {
		const k = reduced() ? 1 : 1 - Math.exp(-dt * 3);
		curF = Math.abs(targetI - curF) > 18 ? targetI : curF + (targetI - curF) * k;
		const cw = container.clientWidth;
		const ch = container.clientHeight;
		const cr = container.getBoundingClientRect();
		let names = null;
		const taken = [];
		const dimNow = new Set();
		for (const p of paths) {
			const on = layer.path && targetI >= p.from && targetI <= p.to;
			p.alpha += ((on ? 1 : 0) - p.alpha) * (reduced() ? 1 : k);
			if (!on && p.alpha < 0.03) p.alpha = 0;
			const prog = on ? pathProgress(p, Math.min(curF, p.to)) : p.drawn;
			p.drawn = prog;
			let segs = 0;
			while (segs < p.prog.length - 1 && p.prog[segs + 1] <= prog + 1e-6) segs++;
			p.mesh.geometry.setDrawRange(0, segs * 6);
			p.mesh.material.uniforms.uA.value = 0.85 * p.alpha;
			p.mesh.material.uniforms.uRes.value.set(cw / 2, ch / 2);
			p.mesh.visible = p.alpha > 0;
			p.stops.forEach((s, j) => {
				const el = p.els[j];
				const show = p.alpha > 0.05 && prog >= j - 1e-6;
				el.classList.toggle("on", show);
				el.style.opacity = show ? p.alpha.toFixed(2) : "0";
				if (!show) return;
				const b = basins.byId.get(s.r.id);
				v.set(b.cx, (b.levelFor(0.3) + 1) * vScale(), b.cz).project(camera);
				const x = (v.x + 1) / 2 * cw;
				const y = (1 - v.y) / 2 * ch;
				el.style.visibility = v.z > 1 ? "hidden" : "";
				el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
				// The date label takes the side that stays clear of the lake names and other stops.
				const t = el.lastChild;
				const tw = t.offsetWidth;
				const th = t.offsetHeight;
				if (!names) {
					names = [ ...labels.layer.querySelectorAll(".lbl-text:not(.far)") ].filter((n) => n.closest(".lbl").style.display !== "none").map((n) => {
						const r = n.getBoundingClientRect();
						return { el: n, left: r.left - cr.left - 2, right: r.right - cr.left + 2, top: r.top - cr.top - 2, bottom: r.bottom - cr.top + 2 };
					});
				}
				const spots = [];
				for (const g of [ 10, 26, 44 ]) spots.push([ g, -th / 2 ], [ -g - tw, -th / 2 ], [ -tw / 2, g ], [ -tw / 2, -g - th ], [ g, g * 0.7 ], [ -g - tw, -g * 0.7 - th ], [ g, -g * 0.7 - th ], [ -g - tw, g * 0.7 ]);
				const over = ([ dx, dy ]) => {
					const box = { left: x + dx, right: x + dx + tw, top: y + dy, bottom: y + dy + th };
					return [ ...names, ...taken ].filter((n) => box.left < n.right && n.left < box.right && box.top < n.bottom && n.top < box.bottom);
				};
				const hits = (sp) => over(sp).length;
				let best = spots[0];
				let bh = hits(best);
				for (const sp of spots.slice(1)) {
					if (!bh) break;
					const h2 = hits(sp);
					if (h2 < bh) {
						best = sp;
						bh = h2;
					}
				}
				t.style.left = `${best[0].toFixed(1)}px`;
				t.style.top = `${best[1].toFixed(1)}px`;
				// A lake name it still cannot clear steps back while the label shows, as under the record-low label.
				for (const n of over(best)) if (n.el) dimNow.add(n.el);
				taken.push({ left: x + best[0], right: x + best[0] + tw, top: y + best[1], bottom: y + best[1] + th });
			});
		}
		for (const el of dimmed) if (!dimNow.has(el)) el.classList.remove("under-path");
		for (const el of dimNow) el.classList.add("under-path");
		dimmed = dimNow;
	}

	return {
		objects: [ dustPts, pathGroup ],
		dustPts,
		pathGroup,
		setMonth(i, fast) {
			targetI = i;
			setFront(i);
			triggerFlares(i, fast);
		},
		jump(i) {
			targetI = i;
			curF = i;
		},
		update(dt, now, camera) {
			if (mixT < 1) {
				mixT = reduced() ? 1 : Math.min(1, mixT + dt * 1000 / FRONT_MS);
			}
			const m = ease(mixT);
			U.uFrontMix.value = m;
			U.uFrontOn.value = layer.front ? 1 : 0;
			stepDust(dt, m);
			placeFlares(now, camera);
			stepPath(dt, camera);
			flareLayer.classList.toggle("path-off", !layer.path);
		},
		// For tests and the camera follow.
		stats: () => ({ ...stats, mix: U.uFrontMix.value, on: U.uFrontOn.value, dust: dustPts.visible ? dustLive : 0 }),
		flares: () => ({ active: slots.filter((s) => s.f).map((s) => ({ id: s.f.r.id, kind: s.f.kind, month: data.months[s.f.i] })), queued: queue.map((f) => f.r.id), fired: fired.slice() }),
		flareNow: () => slots.find((s) => s.f)?.f ?? null,
		paths: () => paths.map((p) => ({ label: p.label, from: data.months[p.from], to: data.months[p.to], stops: p.stops.map((s) => ({ id: s.r.id, month: s.month, oa: s.oa })), visible: p.mesh.visible, alpha: p.alpha, drawn: p.drawn, shown: p.els.filter((e) => e.classList.contains("on")).length })),
		dispose() {
			dGeom.dispose();
			dMat.dispose();
			paths.forEach((p) => {
				p.mesh.geometry.dispose();
				p.mesh.material.dispose();
			});
			A.tex.dispose();
			B.tex.dispose();
			flareLayer.remove();
		},
	};
}
