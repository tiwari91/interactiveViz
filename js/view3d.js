// 3D view: real terrain with carved reservoirs, dams and rivers. Handles the
// month animation, picking, fly-to, drought replay, compare split and sound cues.
import { loadThree, webglAvailable } from "./three/loader.js";
import { createScene, homePose, comparePose } from "./three/scene.js";
import { createWorld, loadElevation } from "./three/world.js";
import { createBasins } from "./three/basins.js";
import { createTerrain } from "./three/terrain.js";
import { createLakes, createOcean, waterUniforms } from "./three/water.js";
import { createDams } from "./three/dams.js";
import { createGaugeLinks } from "./three/gaugeLinks.js";
import { createOutflow } from "./three/outflow.js";
import { createRiparian } from "./three/riparian.js";
import { createMainRivers } from "./three/mainRivers.js";
import { createSky, applyPreset } from "./three/sky.js";
import { createLabels } from "./three/labels.js";
import { createSnapshots } from "./three/snapshot.js";
import { flyTo, poseOf, poseToPosition, replayPath } from "./three/camera.js";
import { createControls3D } from "./three/controls3d.js";
import { getQuality, saveQuality } from "./three/quality.js";
import { currentTheme } from "./theme.js";

const d3 = window.d3;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// The replay lasts about a minute however many months there are, but never
// rushes faster than this per month.
const REPLAY_TOTAL_MS = 60000;
const REPLAY_MIN_MS_PER_MONTH = 250;
// Camera moves are instant under reduced motion.
const motionMs = (ms) => (reducedMotion.matches ? 1 : ms);

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
		terrain.detail.anisotropy = sc.renderer.capabilities.getMaxAnisotropy();
		await step(0.8, "Placing dams and rivers…");
		const shared = waterUniforms(THREE);
		const lakes = createLakes(THREE, basins, shared);
		const ocean = createOcean(THREE, shared);
		const dams = createDams(THREE, data, basins);
		const links = createGaugeLinks(THREE, data, world, basins);
		const outflow = createOutflow(THREE, basins, dams, world, shared, ui.quality);
		const mainRivers = createMainRivers(THREE, world, outflow.router, shared, basins);
		const riparian = createRiparian(THREE, outflow, outflow.router, basins, world, ui.quality);
		await step(0.95, "Filling lakes…");
		const sky = createSky(THREE);
		const maxCap = Math.max(...data.reservoirs.map((r) => r.capacity));
		const labels = createLabels(THREE, container, basins, maxCap);
		let labelsLeft = null;
		let leftIndex = -1;
		// A small north arrow: views like the compare framing turn the state on its side.
		const compass = document.createElement("div");
		compass.className = "compass";
		compass.setAttribute("aria-hidden", "true");
		compass.innerHTML = "<svg viewBox=\"-14 -14 28 28\" width=\"28\" height=\"28\"><path d=\"M0 -10 L4 1 L0 -1.5 L-4 1 Z\"/><text y=\"10\" text-anchor=\"middle\">N</text></svg>";
		container.appendChild(compass);
		const north = [ new THREE.Vector3(), new THREE.Vector3() ];
		let northDeg = null;
		const snapshot = createSnapshots(data, basins, dams.foam.spots);
		dams.foam.uniforms.uTime = shared.uTime;
		dams.foam.mesh.material.uniforms.uTime = shared.uTime;
		sc.scene.add(sky.mesh, terrain.group, ocean.mesh, lakes.mesh, dams.mesh, dams.foam.mesh, links.group, outflow.group, riparian.group, mainRivers.mesh);

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
		const cur = { levels: [ ...s0.levels ], foam: [ ...s0.foam ], outlet: [ ...s0.outlet ], spill: [ ...s0.spill ], dryness: s0.dryness, gold: s0.gold };
		let target = s0;
		const presetParts = { sky, sun: sc.sun, hemi: sc.hemi, scene: sc.scene, water: shared, lakes, ocean, terrain };
		const usePreset = (name) => {
			const p = applyPreset(name, presetParts);
			sc.updateEnv(sky.mesh, p.env);
			const nightV = name === "night" ? 1 : 0;
			outflow.setNight(nightV);
			links.setTheme(nightV > 0);
			dams.foam.uniforms.uNight.value = nightV;
			shared.uLift.value = nightV;
			terrain.setNight(nightV);
			mainRivers.setNight(nightV);
			return p;
		};
		let preset = usePreset(skyName());

		function applyState(state, snap) {
			lakes.apply(state.levels, snap.tints, snap.visible);
			dams.foam.apply(state.foam);
			outflow.apply(state.outlet, state.spill);
			terrain.setDryness(state.dryness);
			terrain.setGold(state.gold);
			mainRivers.setFlow(1 - state.dryness);
		}

		// Camera: start pulled back, then settle on the home pose.
		sc.resize();
		const home = () => homePose(sc.camera.aspect);
		const start = { ...home(), dist: home().dist * 1.35, polar: home().polar * 0.8 };
		sc.controls.target.set(...start.target);
		sc.camera.position.copy(poseToPosition(THREE, start));
		let mover = flyTo(THREE, sc.camera, sc.controls, home(), motionMs(1800));
		const replayMsPerMonth = Math.max(REPLAY_MIN_MS_PER_MONTH, REPLAY_TOTAL_MS / Math.max(1, data.months.length - 1));
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
		let viewShift = 0;
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
		// Keyboard: the 3D view is one tab stop. Arrow keys move between the reservoirs on
		// screen (nearest in that direction), announced through the live tooltip; Enter or
		// Space flies to one; Escape goes back to the state view.
		canvas.tabIndex = 0;
		canvas.setAttribute("role", "application");
		canvas.setAttribute("aria-roledescription", "3D map");
		canvas.setAttribute("aria-label", "3D terrain of California with reservoirs, dams and rivers. Arrow keys move between reservoirs, Enter flies to one, Escape returns to the state view.");
		let kbId = null;
		const kbV = new THREE.Vector3();
		const onScreen = () => basins.basins.map((b, index) => {
			kbV.set(b.cx, b.P + 2.2, b.cz).project(sc.camera);
			return { b, index, x: (kbV.x + 1) / 2 * canvas.clientWidth, y: (1 - kbV.y) / 2 * canvas.clientHeight, ok: kbV.z < 1 && Math.abs(kbV.x) < 1 && Math.abs(kbV.y) < 1 };
		}).filter((p) => p.ok);
		function kbShow(p) {
			kbId = p.b.r.id;
			hovered = kbId;
			lakes.setHighlight(p.index);
			links.setActive(store.get().selected ?? kbId);
			const i = store.get().dateIndex;
			tooltip.showReservoir(p.b.r, i, data.dates[i], p.x, p.y);
		}
		const KB_DIRS = { ArrowRight: [ 1, 0 ], ArrowLeft: [ -1, 0 ], ArrowDown: [ 0, 1 ], ArrowUp: [ 0, -1 ] };
		canvas.addEventListener("keydown", (e) => {
			if (ui.replaying) return;
			const dir = KB_DIRS[e.key];
			if (dir) {
				e.preventDefault();
				const pts = onScreen();
				if (!pts.length) return;
				const cur = pts.find((p) => p.b.r.id === kbId);
				if (!cur) {
					// Start from the selected lake, else the largest one in view.
					kbShow(pts.find((p) => p.b.r.id === store.get().selected) ?? pts.reduce((a, p) => (p.b.r.capacity > a.b.r.capacity ? p : a)));
					return;
				}
				let best = null;
				for (const p of pts) {
					if (p === cur) continue;
					const along = (p.x - cur.x) * dir[0] + (p.y - cur.y) * dir[1];
					if (along <= 0.5) continue;
					const score = along + Math.abs((p.x - cur.x) * dir[1] - (p.y - cur.y) * dir[0]) * 2.5;
					if (!best || score < best.score) best = { p, score };
				}
				if (best) kbShow(best.p);
			} else if ((e.key === "Enter" || e.key === " ") && kbId) {
				e.preventDefault();
				tooltip.hide();
				if (store.get().selected === kbId) focus(kbId);
				else store.set({ selected: kbId });
			} else if (e.key === "Escape" && !store.get().selected) {
				mover = flyTo(THREE, sc.camera, sc.controls, home(), motionMs(1200));
			}
		});
		canvas.addEventListener("blur", () => {
			if (hovered === kbId) {
				hovered = null;
				lakes.setHighlight(store.get().selected ? basins.basins.findIndex((b) => b.r.id === store.get().selected) : -1);
				tooltip.hide();
			}
			kbId = null;
		});

		// Zoom toward the point under the cursor: before the controls dolly, slide the
		// target (and camera with it) a little toward the ground point under the pointer.
		canvas.addEventListener("wheel", (e) => {
			if (ui.replaying || e.deltaY >= 0) return;
			const p = local(e);
			ndc.set((p[0] / canvas.clientWidth) * 2 - 1, -(p[1] / canvas.clientHeight) * 2 + 1);
			raycaster.setFromCamera(ndc, sc.camera);
			const o = raycaster.ray.origin;
			const d = raycaster.ray.direction;
			if (d.y >= -0.02) return;
			// March the ray down to the ground.
			let hit = null;
			const far = sc.camera.position.distanceTo(sc.controls.target) * 3;
			for (let t = 0; t < far; t += far / 160) {
				const x = o.x + d.x * t;
				const y = o.y + d.y * t;
				const z = o.z + d.z * t;
				if (y <= groundAt(x, z)) {
					hit = [ x, y, z ];
					break;
				}
			}
			if (!hit) return;
			const k = Math.min(0.2, 0.0015 * Math.min(200, -e.deltaY));
			const shift = new THREE.Vector3(hit[0] - sc.controls.target.x, hit[1] - sc.controls.target.y, hit[2] - sc.controls.target.z).multiplyScalar(k);
			sc.controls.target.add(shift);
			sc.camera.position.add(shift);
			mover = null;
		}, { passive: true, capture: true });
		sc.controls.addEventListener("start", () => {
			dragging = true;
			mover = null;
			tooltip.hide();
		});
		sc.controls.addEventListener("end", () => {
			dragging = false;
		});

		// Fly in to frame the dam with its lake behind it, from the downstream side.
		function focusPose(id) {
			const b = basins.byId.get(id);
			const info = dams.info.get(id);
			const dir = [ -b.eu[0] * 0.85 + b.ev[0] * 0.5, -b.eu[1] * 0.85 + b.ev[1] * 0.5 ];
			const [ dx, dz ] = info.center;
			return {
				target: [ dx + (b.cx - dx) * 0.3, info.crest - info.height * 0.35, dz + (b.cz - dz) * 0.3 ],
				dist: 8 + info.halfWidth * 2.2 + b.Lu * 0.55,
				polar: 0.98,
				az: Math.atan2(dir[0], dir[1]),
			};
		}
		function focus(id) {
			if (!basins.byId.get(id)) return;
			mover = flyTo(THREE, sc.camera, sc.controls, focusPose(id), motionMs(1500));
			audio.whoosh();
		}

		// Ground under a point: carved basin surface if any, else the DEM; never below the sea plane.
		const groundAt = (x, z) => {
			const s = basins.surfaceAt(x, z);
			return Math.max(0.3, s ? s.h : world.groundY(x, z));
		};
		// Keep the camera above the terrain and its view of the target clear: sample the
		// ground along the sight line and lift the camera until every sample is above it.
		const CLEAR_F = [ 1, 0.9, 0.78, 0.64, 0.5, 0.36 ];
		function keepAbove() {
			const t = sc.controls.target;
			const p = sc.camera.position;
			const dist = p.distanceTo(t);
			const margin = 1.5 + dist * 0.05;
			let need = -Infinity;
			for (const f of CLEAR_F) {
				const x = t.x + (p.x - t.x) * f;
				const z = t.z + (p.z - t.z) * f;
				let g = groundAt(x, z);
				if (f === 1) for (const [ ox, oz ] of [ [ 2, 0 ], [ -2, 0 ], [ 0, 2 ], [ 0, -2 ] ]) g = Math.max(g, groundAt(x + ox, z + oz));
				need = Math.max(need, t.y + (g + margin * f - t.y) / f);
			}
			if (need > p.y) p.y = need;
			return need;
		}

		function frame(now) {
			if (!running) return;
			raf = requestAnimationFrame(frame);
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (!reducedMotion.matches) shared.uTime.value = now / 1000;

			if (replayFn) {
				// A frame's timestamp can predate replayStart by a few ms; never go below month 0.
				const t = Math.max(0, (now - replayStart) / (replayMsPerMonth * (data.months.length - 1)));
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
			keepAbove();
			if (shared.uLift.value > 0) {
				// Keep the moon low in front of the camera so lakes show its reflection path.
				// Its elevation matches the view's pitch, so the path runs through the middle of the view.
				const f = sc.controls.target.clone().sub(sc.camera.position);
				const h = Math.hypot(f.x, f.z) || 1;
				const el = Math.min(0.9, Math.max(0.15, Math.atan2(-f.y, h)));
				shared.uMoonDir.value.set(f.x / h * Math.cos(el), Math.sin(el), f.z / h * Math.cos(el));
			}
			riparian.update(sc.camera, groundAt(sc.camera.position.x, sc.camera.position.z));
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
			cur.gold += (target.gold - cur.gold) * k * 0.6;

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
			// With the detail card open on a wide stage, shift the picture right so the
			// flown-to dam is centred in the space beside the card, not under it.
			const card = stage.querySelector(".detail-card");
			const shift = card && !card.hidden && w > 760 && !ui.comparing ? Math.round((card.offsetWidth + 12) / 2) : 0;
			if (shift !== viewShift || (shift && (w !== sc.camera.view?.fullWidth || h !== sc.camera.view?.fullHeight))) {
				viewShift = shift;
				if (shift) sc.camera.setViewOffset(w, h, -shift, 0, w, h);
				else sc.camera.clearViewOffset();
			}
			// Portrait stages split top/bottom (top = the picked month), wide ones left/right.
			const stacked = h > w;
			if (stacked !== controls.stacked) controls.setStacked(stacked);
			// Screen boxes [x0, x1, y0, y1] of the compare month's half and the current month's half.
			let halves = null;
			if (ui.comparing) {
				const split = Math.round((stacked ? h : w) * controls.divider);
				halves = stacked ? [ [ 0, w, 0, split ], [ 0, w, split, h ] ] : [ [ 0, split, 0, h ], [ split, w, 0, h ] ];
				// WebGL scissor boxes count y up from the bottom.
				const scissor = ([ x0, x1, y0, y1 ]) => sc.renderer.setScissor(x0, h - y1, x1 - x0, y1 - y0);
				sc.renderer.setScissorTest(true);
				const left = snapshot(ui.compareIndex);
				applyState(left, left);
				outflow.useCompare(left.outlet);
				scissor(halves[0]);
				sc.renderer.render(sc.scene, sc.camera);
				outflow.useCompare(null);
				applyState(cur, target);
				scissor(halves[1]);
				sc.renderer.render(sc.scene, sc.camera);
				sc.renderer.setScissorTest(false);
			} else {
				applyState(cur, target);
				sc.renderer.render(sc.scene, sc.camera);
			}
			north[0].copy(sc.controls.target).project(sc.camera);
			north[1].copy(sc.controls.target).add(v3.set(0, 0, -100)).project(sc.camera);
			const deg = Math.round(Math.atan2((north[1].x - north[0].x) * w, (north[1].y - north[0].y) * h) * 180 / Math.PI);
			if (deg !== northDeg) {
				northDeg = deg;
				compass.firstChild.style.transform = `rotate(${deg}deg)`;
			}
			// Compare: each half carries its own month's dots and names, clipped to that half.
			const reachScale = home().dist / homePose(1.6).dist;
			if (ui.comparing) {
				if (!labelsLeft) labelsLeft = createLabels(THREE, container, basins, maxCap);
				if (leftIndex !== ui.compareIndex) {
					leftIndex = ui.compareIndex;
					labelsLeft.setValues(leftIndex);
				}
				// Names keep clear of the month pickers and their summary chips.
				const cr = container.getBoundingClientRect();
				const avoid = controls.tagRects().map((r) => [ r.left - cr.left - 4, r.top - cr.top - 4, r.right - cr.left + 4, r.bottom - cr.top + 4 ]);
				labelsLeft.update(sc.camera, w, h, null, false, sc.controls.target, groundAt, reachScale, halves[0], avoid);
				labels.update(sc.camera, w, h, store.get().selected ?? hovered, false, sc.controls.target, groundAt, reachScale, halves[1], avoid);
			} else {
				if (labelsLeft) labelsLeft.update(sc.camera, w, h, null, true);
				labels.update(sc.camera, w, h, store.get().selected ?? hovered, false, sc.controls.target, groundAt, reachScale);
			}

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
				mover = flyTo(THREE, sc.camera, sc.controls, home(), motionMs(1200));
				audio.whoosh();
			},
			// Frame the state for the compare split (wide stages only).
			// Only from the state view: a close look at one lake stays where it is.
			compareView(on) {
				const now = poseOf(THREE, sc.camera, sc.controls);
				const cp = comparePose(sc.camera.aspect);
				if (!cp || now.dist < home().dist * 0.6) return;
				if (!on && Math.abs(now.az - cp.az) > 0.05) return;
				mover = flyTo(THREE, sc.camera, sc.controls, on ? cp : home(), motionMs(1200));
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
					// Under reduced motion the camera cuts from stop to stop instead of flying.
					replayFn = replayPath([
						{ ...wide, dist: wide.dist * 1.05 },
						keyAt("SHA", 230, 0.5),
						keyAt("ORO", 210, -0.3),
						keyAt("FOL", 260, 0.35, 1.02),
						keyAt("NML", 230, -0.25),
						keyAt("PNF", 250, 0.45),
						{ ...wide, dist: wide.dist * 1.08 },
					], { cut: reducedMotion.matches });
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
			riverEndings: () => outflow.endings,
			anisotropy: () => terrain.detail.anisotropy,
			mainRivers: () => mainRivers.names,
			waterways: () => ({ delta: mainRivers.delta, canals: mainRivers.canals, ends: mainRivers.ends }),
			project: (ll) => world.project(ll),
			// For tests: is the terrain cell at a lon/lat drawn as sea?
			isSea(lon, lat) {
				const e = world.elev;
				const r = Math.round((e.north - lat) / world.dlat);
				const c = Math.round((lon - e.west) / world.dlon);
				const i = r * e.cols + c;
				return e.data[i] <= 0 && world.bayMask[i] < 0.5;
			},
			moonDir: () => shared.uMoonDir.value.clone(),
			gold: () => target.gold,
			goldNow: () => terrain.gold,
			groundSamples: () => outflow.groundSamples(),
			ribbonCompare: () => outflow.compareState(),
			riverLevelsReady: () => outflow.levelsReady(),
			lakeEdgeSoft: () => Boolean(lakes.mesh.material.uniforms.uBed?.value) && /edgeA/.test(lakes.mesh.material.fragmentShader),
			riparian: () => ({ ...riparian.counts, minVeg: riparian.minVegetation(), fade: riparian.fade }),
			// For tests: the largest step (metres) between a land DEM cell and the mean of its neighbours.
			maxSpike() {
				const { rows, cols, data: z } = world.elev;
				let worst = 0;
				for (let r = 1; r < rows - 1; r++) {
					for (let c = 1; c < cols - 1; c++) {
						const i = r * cols + c;
						if (z[i] <= 0) continue;
						worst = Math.max(worst, Math.abs(z[i] - (z[i - 1] + z[i + 1] + z[i - cols] + z[i + cols]) / 4));
					}
				}
				return worst;
			},
			// For tests: camera height above the ground beneath it, and the fly-to pose for a lake.
			clearance: () => sc.camera.position.y - groundAt(sc.camera.position.x, sc.camera.position.z),
			focusPose,
			damInView(id) {
				const info = dams.info.get(id);
				v3.set(info.center[0], info.crest, info.center[1]).project(sc.camera);
				return v3.z < 1 && Math.abs(v3.x) < 0.9 && Math.abs(v3.y) < 0.9;
			},
			// For tests: lowest height of each spillway chute floor above the ground under its full width.
			chuteClearance: () => [ ...dams.info.values() ].filter((d) => d.chute).map((d) => d.chuteClear),
			linksVisible: () => links.visibleCount(),
			setLinks: (v) => links.setShowAll(v),
			pose: () => poseOf(THREE, sc.camera, sc.controls),
			moving: () => Boolean(mover || replayFn),
			northDeg: () => northDeg,
			keyboardPick: () => kbId,
			dispose() {
				this.stop();
				unsub();
				ro.disconnect();
				sc.disposeEnv();
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
		// From the overview (nothing selected), reframe for the split and back again.
		if (ctx && !store.get().selected && !ui.replaying) ctx.compareView(ui.comparing);
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
