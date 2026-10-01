// 3D view: real terrain with carved reservoirs, dams and rivers. Handles the
// month animation, picking, fly-to, drought replay, compare split and sound cues.
import { loadThree, webglAvailable } from "./three/loader.js";
import { createScene, homePose } from "./three/scene.js";
import { createWorld, loadElevation } from "./three/world.js";
import { createBasins } from "./three/basins.js";
import { createTerrain } from "./three/terrain.js";
import { createLakes, createOcean, waterUniforms } from "./three/water.js";
import { createDams } from "./three/dams.js";
import { createGaugeLinks } from "./three/gaugeLinks.js";
import { createOutflow } from "./three/outflow.js";
import { createSky, applyPreset } from "./three/sky.js";
import { createLabels } from "./three/labels.js";
import { createSnapshots } from "./three/snapshot.js";
import { flyTo, poseOf, poseToPosition, replayPath } from "./three/camera.js";
import { createControls3D } from "./three/controls3d.js";
import { getQuality, saveQuality } from "./three/quality.js";
import { currentTheme } from "./theme.js";

const d3 = window.d3;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const REPLAY_MS_PER_MONTH = 650;

export function createView3D(container, data, store, tooltip, audio) {
	const stage = container.parentElement;
	let ctx = null;
	let ready = null;
	let running = false;
	let raf = 0;
	const ui = {
		quality: getQuality(),
		sky: null, // null = follow the page theme
		comparing: false,
		links: false,
		compareIndex: Math.max(0, data.months.indexOf("2014-09")),
		replaying: false,
	};

	const controls = createControls3D(stage, data, {
		replay: () => (ui.replaying ? stopReplay() : startReplay()),
		compare: () => toggleCompare(),
		links: () => {
			ui.links = !ui.links;
			if (ctx) ctx.setLinks(ui.links);
			syncControls();
		},
		sky: (name) => {
			ui.sky = name;
			if (ctx) ctx.preset(name);
			syncControls();
		},
		quality: (q) => {
			ui.quality = q;
			saveQuality(q);
			rebuild();
		},
		compareMonth: (i) => {
			ui.compareIndex = i;
			syncControls();
		},
		divider: () => {},
	});

	function skyName() {
		return ui.sky ?? (currentTheme() === "dark" ? "night" : "day");
	}

	function syncControls() {
		controls.setState({ ...ui, sky: skyName(), dateIndex: store.get().dateIndex });
	}

	async function init(progress) {
		if (!webglAvailable()) {
			container.innerHTML = "<div class=\"webgl-fallback\">3D needs WebGL, which this browser has turned off. The 2D map shows the same data.</div>";
			return null;
		}
		// Let the loading bar paint between the heavy synchronous steps.
		const step = async (f, text) => {
			progress(f, text);
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
		};
		await step(0.1, "Loading three.js and elevation…");
		const [ THREE, elev ] = await Promise.all([ loadThree(), loadElevation(ui.quality) ]);
		await step(0.35, "Carving reservoir basins…");
		const sc = createScene(THREE, container, ui.quality);
		const world = createWorld(data, elev);
		const basins = createBasins(data, world);
		await step(0.55, "Building terrain…");
		const terrain = createTerrain(THREE, data, world, basins, ui.quality);
		await step(0.8, "Placing dams and rivers…");
		const shared = waterUniforms(THREE);
		const lakes = createLakes(THREE, basins, shared);
		const ocean = createOcean(THREE, shared);
		const dams = createDams(THREE, data, basins);
		const links = createGaugeLinks(THREE, data, world, basins);
		const outflow = createOutflow(THREE, basins, dams, world, shared, ui.quality);
		await step(0.95, "Filling lakes…");
		const sky = createSky(THREE);
		const maxCap = Math.max(...data.reservoirs.map((r) => r.capacity));
		const labels = createLabels(THREE, container, basins, maxCap);
		const snapshot = createSnapshots(data, basins, dams.foam.spots);
		dams.foam.uniforms.uTime = shared.uTime;
		dams.foam.mesh.material.uniforms.uTime = shared.uTime;
		sc.scene.add(sky.mesh, terrain.group, ocean.mesh, lakes.mesh, dams.mesh, dams.foam.mesh, links.group, outflow.group);

		// Invisible pick volumes over each lake and dam.
		const pickGeom = new THREE.CylinderGeometry(1, 1, 1, 18);
		const pick = new THREE.InstancedMesh(pickGeom, new THREE.MeshBasicMaterial({ visible: false }), basins.basins.length);
		const m4 = new THREE.Matrix4();
		const basis = new THREE.Matrix4();
		basins.basins.forEach((b, i) => {
			const mid = (b.u0 - 0.6 + b.Lu * 1.2) / 2;
			const [ x, z ] = b.toWorld(mid, 0);
			basis.makeBasis(new THREE.Vector3(b.eu[0], 0, b.eu[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.ev[0], 0, b.ev[1]));
			m4.makeScale((b.Lu * 1.2 - b.u0 + 0.6) / 2, b.D + 4, b.Lv * 1.15).premultiply(basis).setPosition(x, b.P - b.D / 2 + 1, z);
			pick.setMatrixAt(i, m4);
		});
		sc.scene.add(pick);

		// Animated state starts at the current month.
		const s0 = snapshot(store.get().dateIndex);
		const cur = { levels: [ ...s0.levels ], foam: [ ...s0.foam ], outlet: [ ...s0.outlet ], spill: [ ...s0.spill ], dryness: s0.dryness };
		let target = s0;
		const presetParts = { sky, sun: sc.sun, hemi: sc.hemi, scene: sc.scene, water: shared, lakes, ocean, terrain };
		const usePreset = (name) => {
			const p = applyPreset(name, presetParts);
			const nightV = name === "night" ? 1 : 0;
			outflow.setNight(nightV);
			links.setTheme(nightV > 0);
			dams.foam.uniforms.uNight.value = nightV;
			shared.uLift.value = nightV;
			return p;
		};
		let preset = usePreset(skyName());

		function applyState(state, snap) {
			lakes.apply(state.levels, snap.tints, snap.visible);
			dams.foam.apply(state.foam);
			outflow.apply(state.outlet, state.spill);
			terrain.setDryness(state.dryness);
		}

		// Camera: start pulled back, then settle on the home pose.
		sc.resize();
		const home = () => homePose(sc.camera.aspect);
		const start = { ...home(), dist: home().dist * 1.35, polar: home().polar * 0.8 };
		sc.controls.target.set(...start.target);
		sc.camera.position.copy(poseToPosition(THREE, start));
		let mover = flyTo(THREE, sc.camera, sc.controls, home(), reducedMotion.matches ? 1 : 1800);
		let replayFn = null;
		let replayStart = 0;

		const raycaster = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		const canvas = sc.renderer.domElement;
		let pointer = null;
		let hovered = null;
		let dragging = false;
		let down = null;
		let lastAudio = 0;
		let last = performance.now();

		function pickAt(x, y) {
			ndc.set((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
			raycaster.setFromCamera(ndc, sc.camera);
			const hits = raycaster.intersectObjects(links.gauges.visible ? [ pick, links.gauges ] : [ pick ], false);
			const h = hits[0];
			if (!h) return null;
			if (h.object === pick) return { reservoir: basins.basins[h.instanceId].r, index: h.instanceId };
			return { gauge: data.gauges[h.instanceId] };
		}

		const local = (e) => {
			const r = canvas.getBoundingClientRect();
			return [ e.clientX - r.left, e.clientY - r.top ];
		};
		canvas.addEventListener("pointermove", (e) => {
			if (e.pointerType !== "touch") pointer = local(e);
		});
		canvas.addEventListener("pointerleave", () => {
			pointer = null;
			hovered = null;
			lakes.setHighlight(-1);
			tooltip.hide();
			canvas.style.cursor = "";
		});
		canvas.addEventListener("pointerdown", (e) => {
			down = { p: local(e), t: performance.now() };
			if (ui.replaying) stopReplay();
		});
		canvas.addEventListener("pointerup", (e) => {
			if (!down) return;
			const p = local(e);
			const moved = Math.hypot(p[0] - down.p[0], p[1] - down.p[1]);
			const quick = performance.now() - down.t < 600;
			down = null;
			if (moved > 8 || !quick) return;
			const h = pickAt(p[0], p[1]);
			if (h && h.reservoir) {
				tooltip.hide();
				store.set({ selected: h.reservoir.id });
			} else if (h && h.gauge) {
				const i = store.get().dateIndex;
				tooltip.showGauge(h.gauge, i, data.dates[i], p[0], p[1]);
			} else {
				store.set({ selected: null });
				tooltip.hide();
			}
		});
		sc.controls.addEventListener("start", () => {
			dragging = true;
			mover = null;
			tooltip.hide();
		});
		sc.controls.addEventListener("end", () => {
			dragging = false;
		});

		function focus(id) {
			const b = basins.byId.get(id);
			if (!b) return;
			const dir = [ -b.eu[0] * 0.8 + b.ev[0] * 0.6, -b.eu[1] * 0.8 + b.ev[1] * 0.6 ];
			mover = flyTo(THREE, sc.camera, sc.controls, {
				target: [ b.cx - b.eu[0] * b.Lu * 0.5, b.P - b.D * 0.4, b.cz - b.eu[1] * b.Lu * 0.5 ],
				dist: 16 + b.Lu * 3.4,
				polar: 1.02,
				az: Math.atan2(dir[0], dir[1]),
			}, 1500);
			audio.whoosh();
		}

		function frame(now) {
			if (!running) return;
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (!reducedMotion.matches) shared.uTime.value = now / 1000;

			if (replayFn) {
				const t = (now - replayStart) / (REPLAY_MS_PER_MONTH * (data.months.length - 1));
				if (t >= 1) stopReplay(true);
				else {
					const p = replayFn(t);
					sc.controls.target.set(...p.target);
					sc.camera.position.copy(poseToPosition(THREE, p));
					const idx = Math.min(data.months.length - 1, Math.floor(t * (data.months.length - 1) + 0.0001));
					if (idx !== store.get().dateIndex) store.set({ dateIndex: idx });
				}
			} else if (mover && mover(now)) mover = null;
			sc.controls.update();
			sc.updateSun();

			// Ease toward the target month.
			const k = 1 - Math.exp(-dt * 4.5);
			for (let i = 0; i < cur.levels.length; i++) cur.levels[i] += (target.levels[i] - cur.levels[i]) * k;
			for (let i = 0; i < cur.foam.length; i++) cur.foam[i] += (target.foam[i] - cur.foam[i]) * k;
			for (let i = 0; i < cur.outlet.length; i++) {
				cur.outlet[i] += (target.outlet[i] - cur.outlet[i]) * k;
				cur.spill[i] += (target.spill[i] - cur.spill[i]) * k;
			}
			cur.dryness += (target.dryness - cur.dryness) * k * 0.6;

			if (pointer && !dragging && !replayFn) {
				const h = pickAt(pointer[0], pointer[1]);
				const key = h ? (h.reservoir ? h.reservoir.id : h.gauge.id) : null;
				canvas.style.cursor = key ? "pointer" : "";
				if (key !== hovered) {
					lakes.setHighlight(h && h.reservoir ? h.index : -1);
					links.setActive(store.get().selected ?? (h && h.reservoir ? h.reservoir.id : null));
					if (key && h.reservoir) audio.hover();
				}
				const i = store.get().dateIndex;
				if (h && h.reservoir) tooltip.showReservoir(h.reservoir, i, data.dates[i], pointer[0], pointer[1]);
				else if (h) tooltip.showGauge(h.gauge, i, data.dates[i], pointer[0], pointer[1]);
				else if (hovered) tooltip.hide();
				hovered = key;
				pointer = null;
			}

			const w = container.clientWidth;
			const h = container.clientHeight;
			if (ui.comparing) {
				const split = Math.round(w * controls.divider);
				sc.renderer.setScissorTest(true);
				applyState(snapshot(ui.compareIndex), snapshot(ui.compareIndex));
				sc.renderer.setScissor(0, 0, split, h);
				sc.renderer.render(sc.scene, sc.camera);
				applyState(cur, target);
				sc.renderer.setScissor(split, 0, w - split, h);
				sc.renderer.render(sc.scene, sc.camera);
				sc.renderer.setScissorTest(false);
			} else {
				applyState(cur, target);
				sc.renderer.render(sc.scene, sc.camera);
			}
			labels.update(sc.camera, w, h, store.get().selected ?? hovered, ui.comparing);

			if (now - lastAudio > 150) {
				lastAudio = now;
				spatialAudio();
			}
		}

		const v3 = new THREE.Vector3();
		const toCam = new THREE.Vector3();
		const right = new THREE.Vector3();
		// Distance and stereo direction from the camera to every dam.
		function spatialAudio() {
			if (!audio.ready) return;
			right.setFromMatrixColumn(sc.camera.matrixWorld, 0);
			audio.setListener(basins.basins.map((b) => {
				const info = dams.info.get(b.r.id);
				v3.set(...info.toePoint);
				toCam.copy(v3).sub(sc.camera.position);
				const dist = toCam.length();
				return { id: b.r.id, dist, pan: Math.max(-1, Math.min(1, toCam.dot(right) / Math.max(1, dist) * 1.6)) };
			}));
		}

		function setMonth(i) {
			target = snapshot(i);
			outflow.setWidths(target.outlet);
			labels.setValues(i);
		}
		setMonth(store.get().dateIndex);

		const unsub = store.subscribe((s, changed) => {
			if (changed.includes("dateIndex")) setMonth(s.dateIndex);
			if (changed.includes("selected")) {
				links.setActive(s.selected);
				const idx = basins.basins.findIndex((b) => b.r.id === s.selected);
				lakes.setHighlight(idx);
				if (s.selected && s.mode === "3d") focus(s.selected);
			}
		});
		const ro = new ResizeObserver(() => sc.resize());
		ro.observe(container);

		return {
			THREE,
			sc,
			basins,
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
				mover = flyTo(THREE, sc.camera, sc.controls, home(), 1200);
				audio.whoosh();
			},
			preset(name) {
				preset = usePreset(name);
			},
			focus,
			replay(on) {
				if (on) {
					const keyAt = (id, dist, az, polar = 0.98) => {
						const b = basins.byId.get(id);
						return { target: [ b.cx, b.P - 2, b.cz ], dist, az, polar };
					};
					const wide = home();
					replayFn = replayPath([
						{ ...wide, dist: wide.dist * 1.05 },
						keyAt("SHA", 230, 0.5),
						keyAt("ORO", 210, -0.3),
						keyAt("FOL", 260, 0.35, 1.02),
						keyAt("NML", 230, -0.25),
						keyAt("PNF", 250, 0.45),
						{ ...wide, dist: wide.dist * 1.08 },
					]);
					replayStart = performance.now();
					mover = null;
				} else replayFn = null;
			},
			screenPos(id) {
				const b = basins.byId.get(id);
				v3.set(b.cx, b.levelFor(0.6), b.cz).project(sc.camera);
				return [ (v3.x + 1) / 2 * container.clientWidth, (1 - v3.y) / 2 * container.clientHeight ];
			},
			level: (id) => cur.levels[basins.basins.findIndex((b) => b.r.id === id)],
			// For tests: what each dam is visibly releasing right now.
			outflow: () => outflow.state().map((o, i) => ({ ...o, spill: cur.spill[i], pct: target.release[i].pct })),
			verifyWater: () => outflow.verify(),
			linksVisible: () => links.visibleCount(),
			setLinks: (v) => links.setShowAll(v),
			pose: () => poseOf(THREE, sc.camera, sc.controls),
			moving: () => Boolean(mover || replayFn),
			dispose() {
				this.stop();
				unsub();
				ro.disconnect();
				sc.renderer.dispose();
				sc.renderer.forceContextLoss();
				container.innerHTML = "";
			},
			renderer: sc.renderer,
			get presetName() {
				return preset.label;
			},
		};
	}

	function startReplay() {
		if (!ctx) return;
		ui.replaying = true;
		store.set({ playing: false, selected: null, dateIndex: 0 });
		tooltip.hide();
		ctx.replay(true);
		audio.swell(true);
		syncControls();
	}

	function stopReplay(finished = false) {
		ui.replaying = false;
		if (ctx) {
			ctx.replay(false);
			if (finished) ctx.home();
		}
		audio.swell(false);
		syncControls();
	}

	function toggleCompare() {
		ui.comparing = !ui.comparing;
		if (ui.comparing && store.get().dateIndex === ui.compareIndex) {
			store.set({ dateIndex: Math.max(0, data.months.indexOf("2017-04")) });
		}
		tooltip.hide();
		syncControls();
	}

	async function rebuild() {
		if (!ctx) return;
		stopReplay();
		ctx.dispose();
		ctx = null;
		ready = null;
		await api.mount(api.onProgress);
	}

	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex")) syncControls();
	});

	document.addEventListener("visibilitychange", () => {
		if (!ctx) return;
		if (document.hidden) ctx.stop();
		else if (!container.hidden) ctx.start();
	});

	const api = {
		async mount(progress = () => {}) {
			if (!ready) ready = init(progress).then((c) => (ctx = c));
			await ready;
			controls.show(true);
			syncControls();
			if (ctx) ctx.start();
		},
		pause() {
			controls.show(false);
			audio.setListener(null);
			if (ui.replaying) stopReplay();
			if (ctx) ctx.stop();
		},
		resume() {
			if (ctx) ctx.start();
		},
		resetView() {
			if (ui.replaying) stopReplay();
			if (ctx) ctx.home();
		},
		setTheme() {
			if (ctx && !ui.sky) ctx.preset(skyName());
			syncControls();
		},
		screenPos(id) {
			return ctx ? ctx.screenPos(id) : [ 0, 0 ];
		},
		focusReservoir(r) {
			// Selecting through the store already flies the camera; only refocus a re-pick.
			if (ctx && store.get().selected === r.id) ctx.focus(r.id);
		},
		debug: () => ctx,
		onProgress: () => {},
		available: webglAvailable(),
		ui,
		hint: "Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan. Click a lake to fly in.",
	};
	return api;
}
