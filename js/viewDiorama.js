// Diorama view: California's water system as a model in a glass museum case. Lake levels follow
// the CDEC storage for the selected month; clouds, snowpack and groundwater are illustrative.
// Shares the store, timeline, tooltip and detail card with the 2D and 3D views.
import { loadThree, webglAvailable } from "./three/loader.js";
import { getQuality } from "./three/quality.js";
import { createLandscape, createTerrainMesh, createWalls, createVegetation, FRONT } from "./diorama/landscape.js";
import { createWater, levelFor } from "./diorama/water.js";
import { climate, createWeather } from "./diorama/weather.js";
import { createStage, createCase, KEY_LIGHT } from "./diorama/case.js";
import { pctAt } from "./data.js";
import { fmtPct } from "./scales.js";

const d3 = window.d3;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const IDLE_MS = 6000;

const shortName = (r) => r.name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir|Lake)$/, "").replace(/^Lake /, "");

export function createDiorama(container, data, store, tooltip) {
	const stage = container.parentElement;
	let ctx = null;
	let ready = null;
	const quality = getQuality();
	const wx = climate(data);

	async function init(progress) {
		if (!webglAvailable()) {
			container.innerHTML = "<div class=\"webgl-fallback\">The diorama needs WebGL, which this browser has turned off. The 2D map shows the same data.</div>";
			return null;
		}
		const step = async (f, text) => {
			progress(f, text);
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
		};
		await step(0.1, "Loading three.js…");
		const THREE = await loadThree();
		await step(0.3, "Shaping the landscape…");
		const motion = () => !reducedMotion.matches;
		const st = createStage(THREE, container, quality);
		const land = createLandscape(data);
		const terrain = createTerrainMesh(THREE, land, quality);
		await step(0.55, "Cutting the cross-section…");
		const water = createWater(THREE, land, terrain, quality, motion);
		const sectionLakes = land.lakes.filter((L) => Math.abs(FRONT - L.z) < L.r * L.a);
		const walls = createWalls(THREE, land, terrain, quality, sectionLakes);
		await step(0.75, "Planting trees…");
		const veg = createVegetation(THREE, land, terrain, quality);
		const weather = createWeather(THREE, terrain, quality, motion);
		const cs = createCase(THREE, quality);
		st.scene.add(cs.group, terrain.mesh, walls.mesh, veg.group, water.group, weather.group);
		await step(0.95, "Polishing the glass…");
		try { await document.fonts?.ready; } catch (e) { /* fonts optional */ }

		const { renderer, scene, camera, controls } = st;
		const lakes = land.lakes;
		const N = lakes.length;

		// Labels: a small tag over each lake with its name and % full.
		const layer = document.createElement("div");
		layer.className = "dio-tags";
		container.appendChild(layer);
		// Lens glow: follows where the key light projects, so it blooms in from the frame's edge.
		const glow = document.createElement("div");
		glow.className = "dio-glow";
		container.appendChild(glow);
		const lightPos = new THREE.Vector3(...KEY_LIGHT);
		const tags = lakes.map((L) => {
			const el = document.createElement("div");
			el.className = "dio-tag";
			el.innerHTML = `<span class="dio-tag-name">${shortName(L.reservoir)}</span><span class="dio-tag-pct"></span>`;
			layer.appendChild(el);
			return el;
		});

		// Month state, eased toward the target.
		const lastPct = (r, i) => {
			for (let k = i; k >= 0; k--) {
				const p = pctAt(r, k);
				if (p !== null) return p;
			}
			return 0.5;
		};
		const targetFor = (i) => {
			const pct = data.totals[i].pct;
			const m = data.calMonth[i];
			return {
				pcts: lakes.map((L) => lastPct(L.reservoir, i)),
				levels: lakes.map((L) => levelFor(L, lastPct(L.reservoir, i))),
				flow: Math.min(1, Math.max(0, 0.15 + (pct - 0.3) * 1.2 + wx.wet[i] * 0.5)),
				dry: Math.min(1, Math.max(0, (0.62 - pct) / 0.3)),
				snow: 3.7 - 2.3 * wx.snow[i],
				table: -1.28 + 0.85 * wx.table[i],
				wet: wx.wet[i],
				snowing: m === 11 || m <= 2,
			};
		};
		let target = targetFor(store.get().dateIndex);
		const cur = { levels: [ ...target.levels ], flow: target.flow, dry: target.dry, snow: target.snow, table: target.table };
		let applied = null;

		function applyState(force = false) {
			const sig = cur.levels.map((v) => v.toFixed(4)).join() + cur.flow.toFixed(3);
			if (force || sig !== applied) {
				water.apply(cur.levels, cur.flow);
				terrain.uniforms.uLevel.value = [ ...cur.levels ];
				applied = sig;
			}
			terrain.uniforms.uDry.value = cur.dry;
			terrain.uniforms.uSnow.value = cur.snow;
			walls.uniforms.uTable.value = cur.table;
		}

		function setMonth(i) {
			target = targetFor(i);
			weather.set(target.wet, target.snowing);
			const t = data.totals[i];
			const of = t.ofAvg === null ? "" : ` · ${fmtPct(t.ofAvg)} of average`;
			cs.plate.set(`California’s Water · ${d3.timeFormat("%B %Y")(data.dates[i])}`, `Statewide reservoir storage ${fmtPct(t.pct)} of capacity${of}`);
			tags.forEach((el, k) => {
				const p = pctAt(lakes[k].reservoir, i);
				el.querySelector(".dio-tag-pct").textContent = p === null ? "—" : fmtPct(p);
			});
			if (reducedMotion.matches) {
				Object.assign(cur, { levels: [ ...target.levels ], flow: target.flow, dry: target.dry, snow: target.snow, table: target.table });
			}
		}
		setMonth(store.get().dateIndex);
		applyState(true);

		// Camera: home pose fits the case to the canvas.
		const v3 = new THREE.Vector3();
		function homeDist() {
			const aspect = camera.aspect || 1.6;
			const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
			const half = aspect < 1 ? 7.4 : 9.4; // portrait: the case's width is what has to fit
			return Math.max(17, Math.min(52, half / (tanV * Math.min(aspect, 1.75)) + 2));
		}
		function homePose() {
			return { target: new THREE.Vector3(0, 0.1, 0.3), az: 0.42, polar: 1.12, dist: homeDist() };
		}
		const posFrom = ({ target: t, az, polar, dist }) => new THREE.Vector3(
			t.x + dist * Math.sin(polar) * Math.sin(az), t.y + dist * Math.cos(polar), t.z + dist * Math.sin(polar) * Math.cos(az));

		function resize() {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (!w || !h) return;
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			controls.maxDistance = Math.max(34, homeDist() * 1.25);
		}
		resize();
		{
			const p = homePose();
			controls.target.copy(p.target);
			camera.position.copy(posFrom({ ...p, dist: p.dist * 1.25, az: p.az - 0.5, polar: p.polar - 0.12 }));
		}
		let tween = null;
		function flyTo(pose, ms) {
			const from = { t: controls.target.clone(), p: camera.position.clone() };
			const to = { t: pose.target.clone(), p: posFrom(pose) };
			const t0 = performance.now();
			const dur = reducedMotion.matches ? 1 : ms;
			tween = (now) => {
				const k = Math.min(1, (now - t0) / dur);
				const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
				controls.target.lerpVectors(from.t, to.t, e);
				camera.position.lerpVectors(from.p, to.p, e);
				return k >= 1;
			};
		}
		flyTo(homePose(), 2200);

		function focus(id) {
			const L = lakes.find((l) => l.id === id);
			if (!L) return;
			const off = camera.position.clone().sub(controls.target);
			const az = Math.atan2(off.x, off.z);
			flyTo({ target: new THREE.Vector3(L.x, L.rim - 0.1, Math.min(L.z, FRONT - 0.6)), az, polar: 1.0, dist: 8.5 }, 1400);
		}

		// Pointer: hover shows the shared tooltip, click selects (opens the detail card).
		const canvas = renderer.domElement;
		const raycaster = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		let pointer = null;
		let hovered = null;
		let down = null;
		let lastInput = performance.now();
		const local = (e) => {
			const r = canvas.getBoundingClientRect();
			return [ e.clientX - r.left, e.clientY - r.top ];
		};
		function pickAt(x, y) {
			ndc.set((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
			raycaster.setFromCamera(ndc, camera);
			const h = raycaster.intersectObjects(water.picks, false)[0];
			return h ? h.object.userData.lake : null;
		}
		canvas.addEventListener("pointermove", (e) => {
			if (e.pointerType !== "touch") pointer = local(e);
		});
		canvas.addEventListener("pointerleave", () => {
			pointer = null;
			hovered = null;
			tooltip.hide();
			canvas.style.cursor = "";
		});
		canvas.addEventListener("pointerdown", (e) => {
			down = { p: local(e), t: performance.now() };
			lastInput = performance.now();
		});
		canvas.addEventListener("pointerup", (e) => {
			if (!down) return;
			const p = local(e);
			const quick = performance.now() - down.t < 600 && Math.hypot(p[0] - down.p[0], p[1] - down.p[1]) < 8;
			down = null;
			if (!quick) return;
			const L = pickAt(p[0], p[1]);
			tooltip.hide();
			store.set({ selected: L ? L.id : null });
		});
		controls.addEventListener("start", () => {
			tween = null;
			lastInput = performance.now();
			tooltip.hide();
		});
		canvas.addEventListener("wheel", () => { lastInput = performance.now(); }, { passive: true });

		let running = false;
		let raf = 0;
		let last = performance.now();
		const t0 = performance.now();
		const frames = [];

		function frame(now) {
			if (!running) return;
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			frames.push(now);
			if (frames.length > 90) frames.shift();
			const t = (now - t0) / 1000;

			if (tween && tween(now)) tween = null;
			controls.autoRotate = !reducedMotion.matches && !tween && !hovered && !store.get().selected && now - lastInput > IDLE_MS;
			controls.update();

			const k = 1 - Math.exp(-dt * 3.2);
			for (let i = 0; i < N; i++) cur.levels[i] += (target.levels[i] - cur.levels[i]) * k;
			cur.flow += (target.flow - cur.flow) * k;
			cur.dry += (target.dry - cur.dry) * k * 0.6;
			cur.snow += (target.snow - cur.snow) * k * 0.8;
			cur.table += (target.table - cur.table) * k * 0.5;
			applyState();
			water.tick(t);
			weather.tick(t, dt);

			if (pointer && !down) {
				const L = pickAt(pointer[0], pointer[1]);
				const id = L ? L.id : null;
				canvas.style.cursor = id ? "pointer" : "";
				const i = store.get().dateIndex;
				if (L) tooltip.showReservoir(L.reservoir, i, data.dates[i], pointer[0], pointer[1]);
				else if (hovered) tooltip.hide();
				hovered = id;
				pointer = null;
			}

			renderer.render(scene, camera);

			// Tags follow their lakes; hide those behind the camera or off the stage.
			const w = container.clientWidth;
			const h = container.clientHeight;
			v3.copy(lightPos).project(camera);
			const gx = Math.max(-1.08, Math.min(1.08, v3.x));
			const gy = Math.max(-1.08, Math.min(1.08, v3.y));
			const away = Math.hypot(v3.x - gx, v3.y - gy);
			glow.style.transform = `translate(${((gx + 1) / 2 * w).toFixed(0)}px, ${((1 - gy) / 2 * h).toFixed(0)}px) translate(-50%, -50%)`;
			glow.style.opacity = v3.z > 1 ? "0" : String(Math.max(0.7, 1 - away * 0.3).toFixed(2));
			const sel = store.get().selected;
			lakes.forEach((L, i) => {
				v3.set(L.x, cur.levels[i] + 0.32, L.z).project(camera);
				const el = tags[i];
				const off = v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05;
				el.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
				el.classList.toggle("is-off", off);
				el.classList.toggle("is-active", L.id === sel || L.id === hovered);
			});
		}

		const unsub = store.subscribe((s, changed) => {
			if (changed.includes("dateIndex")) setMonth(s.dateIndex);
			if (changed.includes("selected") && s.selected && s.mode === "diorama") focus(s.selected);
		});
		const ro = new ResizeObserver(resize);
		ro.observe(container);

		return {
			THREE,
			start() {
				if (running) return;
				running = true;
				last = performance.now();
				raf = requestAnimationFrame(frame);
			},
			stop() {
				running = false;
				cancelAnimationFrame(raf);
			},
			home() {
				flyTo(homePose(), 1400);
			},
			focus,
			lakes: () => lakes.map((L) => L.id),
			// For tests: water height above the lake bed as a share of the bowl depth.
			level: (id) => {
				const i = lakes.findIndex((L) => L.id === id);
				return i < 0 ? null : (cur.levels[i] - (lakes[i].rim - lakes[i].depth - 0.012)) / lakes[i].depth;
			},
			targetLevel: (id) => {
				const i = lakes.findIndex((L) => L.id === id);
				return i < 0 ? null : (target.levels[i] - (lakes[i].rim - lakes[i].depth - 0.012)) / lakes[i].depth;
			},
			screenPos(id) {
				const i = lakes.findIndex((L) => L.id === id);
				if (i < 0) return [ 0, 0 ];
				v3.set(lakes[i].x, cur.levels[i], lakes[i].z).project(camera);
				return [ (v3.x + 1) / 2 * container.clientWidth, (1 - v3.y) / 2 * container.clientHeight ];
			},
			weather: () => weather.counts(),
			fps: () => (frames.length > 10 ? (frames.length - 1) * 1000 / (frames[frames.length - 1] - frames[0]) : 0),
			moving: () => Boolean(tween),
			setIdle(on) {
				lastInput = on ? -1e9 : performance.now();
			},
			trees: veg.count,
			renderer,
			camera,
			scene,
			controls,
			dispose() {
				this.stop();
				unsub();
				ro.disconnect();
				renderer.dispose();
				renderer.forceContextLoss();
				container.innerHTML = "";
			},
		};
	}

	document.addEventListener("visibilitychange", () => {
		if (!ctx) return;
		if (document.hidden) ctx.stop();
		else if (!container.hidden) ctx.start();
	});

	return {
		async mount(progress = () => {}) {
			if (!ready) ready = init(progress).then((c) => (ctx = c));
			await ready;
			if (ctx) ctx.start();
		},
		pause() {
			if (ctx) ctx.stop();
		},
		resume() {
			if (ctx) ctx.start();
		},
		resetView() {
			if (ctx) ctx.home();
		},
		setTheme() {},
		screenPos(id) {
			return ctx ? ctx.screenPos(id) : [ 0, 0 ];
		},
		focusReservoir(r) {
			if (ctx && store.get().selected === r.id) ctx.focus(r.id);
		},
		debug: () => ctx,
		available: webglAvailable(),
		hint: "Drag to turn the case, scroll or pinch to zoom. Hover a lake for its storage, click for details. Lake levels are CDEC data; clouds, snow and groundwater are illustrative.",
	};
}
