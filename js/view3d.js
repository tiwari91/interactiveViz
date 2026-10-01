// 3D view: assembles land, reservoirs and streams; handles picking, labels and the render loop.
import { loadThree, webglAvailable } from "./three/loader.js";
import { createScene } from "./three/scene.js";
import { createLand } from "./three/land.js";
import { createReservoirs } from "./three/reservoirs.js";
import { createStreams } from "./three/streams.js";
import { colorFor, makeProjection, MAJOR_CAPACITY } from "./scales.js";
import { cssVar, currentTheme } from "./theme.js";

const WORLD = 1000;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function createView3D(container, data, store, tooltip) {
	const stage = container.parentElement;
	let ready = null;
	let ctx = null;
	let running = false;
	let raf = 0;

	const geo = makeProjection(data.outline, WORLD, WORLD, 0);
	const project = (lonlat) => {
		const [ x, y ] = geo(lonlat);
		return [ x - WORLD / 2, y - WORLD / 2 ];
	};

	async function init() {
		if (!webglAvailable()) {
			container.innerHTML = "<div class=\"webgl-fallback\">3D needs WebGL, which this browser has turned off. The 2D map shows the same data.</div>";
			return null;
		}
		const THREE = await loadThree();
		const sc = createScene(THREE, container);
		const land = createLand(THREE, data, project);
		const res = createReservoirs(THREE, data, project);
		const streams = createStreams(THREE, data, project);
		sc.scene.add(land.group, streams.group, res.group);

		const labelLayer = document.createElement("div");
		labelLayer.className = "labels-3d";
		labelLayer.setAttribute("aria-hidden", "true");
		container.appendChild(labelLayer);
		const labels = [ ...data.reservoirs ].sort((a, b) => b.capacity - a.capacity).filter((r) => r.capacity >= MAJOR_CAPACITY).map((r) => {
			const el = document.createElement("div");
			el.className = "label-3d";
			el.textContent = r.name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir)$/, "");
			labelLayer.appendChild(el);
			return { r, el, w: 0 };
		});

		const raycaster = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		const tmp = new THREE.Vector3();
		const pickTargets = [ ...res.pickables, ...streams.gauges ];
		let pointer = null;
		let hovered = null;
		let dragging = false;
		let down = null;
		// Short fly-in on first open, from a pose fitted to the stage's real aspect.
		sc.resize();
		sc.placeHome(1.45);
		let fly = sc.flyHome(reducedMotion.matches ? 1 : 1400);
		let last = performance.now();

		function pick(x, y) {
			const rect = sc.renderer.domElement.getBoundingClientRect();
			ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
			raycaster.setFromCamera(ndc, sc.camera);
			const hit = raycaster.intersectObjects(pickTargets, false)[0];
			if (!hit) return null;
			return hit.object.userData.reservoir ? { reservoir: hit.object.userData.reservoir } : { gauge: hit.object.userData.gauge };
		}

		function toScreen(v) {
			v.project(sc.camera);
			return [ (v.x + 1) / 2 * container.clientWidth, (1 - v.y) / 2 * container.clientHeight, v.z ];
		}

		function screenPos(id) {
			const [ x, y ] = toScreen(res.topOf(id, tmp));
			return [ x, y ];
		}

		function showHit(h, x, y) {
			const i = store.get().dateIndex;
			if (h.reservoir) tooltip.showReservoir(h.reservoir, i, data.dates[i], x, y);
			else tooltip.showGauge(h.gauge, i, data.dates[i], x, y);
		}

		const canvas = sc.renderer.domElement;
		const local = (e) => {
			const rect = canvas.getBoundingClientRect();
			return [ e.clientX - rect.left, e.clientY - rect.top ];
		};
		canvas.addEventListener("pointermove", (e) => {
			if (e.pointerType === "touch") return;
			pointer = local(e);
		});
		canvas.addEventListener("pointerleave", () => {
			pointer = null;
			if (hovered) tooltip.hide();
			hovered = null;
			canvas.style.cursor = "";
		});
		canvas.addEventListener("pointerdown", (e) => {
			down = { p: local(e), t: performance.now() };
		});
		canvas.addEventListener("pointerup", (e) => {
			if (!down) return;
			const p = local(e);
			const moved = Math.hypot(p[0] - down.p[0], p[1] - down.p[1]);
			const quick = performance.now() - down.t < 600;
			down = null;
			if (moved > 8 || !quick) return;
			const h = pick(p[0], p[1]);
			if (h && h.reservoir) {
				store.set({ selected: h.reservoir.id });
				const [ x, y ] = screenPos(h.reservoir.id);
				showHit(h, x, y);
			} else if (h) {
				showHit(h, p[0], p[1]);
			} else {
				store.set({ selected: null });
				tooltip.hide();
			}
		});
		sc.controls.addEventListener("start", () => {
			dragging = true;
			tooltip.hide();
		});
		sc.controls.addEventListener("end", () => {
			dragging = false;
		});

		function frame(now) {
			if (!running) return;
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (fly && fly(now)) fly = null;
			sc.controls.update();
			res.tick(dt);
			streams.tick(dt, now / 1000, !reducedMotion.matches);

			if (pointer && !dragging) {
				const h = pick(pointer[0], pointer[1]);
				const key = h ? (h.reservoir ? h.reservoir.id : h.gauge.id) : null;
				canvas.style.cursor = key ? "pointer" : "";
				if (h) showHit(h, pointer[0], pointer[1]);
				else if (hovered) tooltip.hide();
				hovered = key;
				pointer = null;
			}

			// Labels, largest first; skip any that would overlap one already placed.
			const placed = [];
			for (const lb of labels) {
				const [ x, y, z ] = toScreen(res.topOf(lb.r.id, tmp));
				if (!lb.w) {
					lb.el.style.display = "";
					lb.w = lb.el.offsetWidth;
					lb.h = lb.el.offsetHeight;
				}
				const box = [ x - lb.w / 2 - 2, y - 20, x + lb.w / 2 + 2, y - 20 + lb.h ];
				const clash = z > 1 || placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
				lb.el.style.display = clash ? "none" : "";
				if (clash) continue;
				placed.push(box);
				lb.el.style.transform = `translate(${Math.round(box[0] + 2)}px, ${Math.round(box[1])}px)`;
			}
			sc.renderer.render(sc.scene, sc.camera);
		}

		function applyTheme(theme) {
			land.setColors({ land: cssVar("--land"), side: cssVar("--land-side"), county: cssVar("--county") });
			res.setColors({ glass: cssVar("--glass"), ink: cssVar("--ink") });
			streams.setTheme(theme, cssVar("--stream"));
			sc.setTheme(theme);
		}

		function update({ dateIndex, selected }, instant = false) {
			res.setTargets(dateIndex, colorFor, instant);
			streams.setTargets(dateIndex, instant);
			res.setActive(selected);
		}

		update(store.get(), true);
		applyTheme(currentTheme());
		store.subscribe((s, changed) => {
			if (changed.includes("dateIndex") || changed.includes("selected")) update(s);
		});
		new ResizeObserver(() => sc.resize()).observe(container);
		sc.resize();

		return {
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
			reset() {
				fly = sc.flyHome(800);
			},
			applyTheme,
			screenPos,
			renderer: sc.renderer,
			waterLevel: (id) => res.byId.get(id).level,
		};
	}

	document.addEventListener("visibilitychange", () => {
		if (!ctx) return;
		if (document.hidden) ctx.stop();
		else if (!container.hidden) ctx.start();
	});

	return {
		async mount() {
			if (!ready) ready = init().then((c) => (ctx = c));
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
			if (ctx) ctx.reset();
		},
		setTheme(theme) {
			if (ctx) ctx.applyTheme(theme);
		},
		screenPos(id) {
			return ctx ? ctx.screenPos(id) : [ 0, 0 ];
		},
		focusReservoir(r) {
			if (!ctx) return;
			const [ x, y ] = ctx.screenPos(r.id);
			const i = store.get().dateIndex;
			tooltip.showReservoir(r, i, data.dates[i], x, y);
		},
		debug: () => ctx,
		hint: "Drag to orbit, pinch or scroll to zoom, right-drag or two fingers to pan. Hover or tap a column.",
	};
}
