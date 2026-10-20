// 3D view: real terrain with carved reservoirs, dams and rivers. Handles the
// month animation, picking, fly-to, drought replay, compare split and sound cues.
import { loadThree, webglAvailable } from "./three/loader.js";
import { createScene, homePose, comparePose } from "./three/scene.js";
import { createWorld, loadElevation, EXAGGERATION } from "./three/world.js";
import { createBasins } from "./three/basins.js";
import { createTerrain } from "./three/terrain.js";
import { createLakes, createOcean, waterUniforms } from "./three/water.js";
import { createDams } from "./three/dams.js";
import { createGaugeLinks } from "./three/gaugeLinks.js";
import { createOutflow } from "./three/outflow.js";
import { createRiparian } from "./three/riparian.js";
import { createWildlife } from "./three/wildlife.js";
import { createMainRivers } from "./three/mainRivers.js";
import { createSky, applyPreset } from "./three/sky.js";
import { createLabels } from "./three/labels.js";
import { createSnapshots } from "./three/snapshot.js";
import { flyTo, poseOf, poseToPosition, replayPath } from "./three/camera.js";
import { createDroughtFx } from "./three/droughtFx.js";
import { driestAt } from "./drought.js";
import { createControls3D } from "./three/controls3d.js";
import { getQuality, saveQuality } from "./three/quality.js";
import { createPulses } from "./three/pulses.js";
import { createSnow } from "./three/snow.js";
import { currentTheme } from "./theme.js";

const d3 = window.d3;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// The replay lasts about a minute however many months there are, but never
// rushes faster than this per month.
const REPLAY_TOTAL_MS = 120000;
const REPLAY_MIN_MS_PER_MONTH = 500;
// Camera moves are instant under reduced motion.
const motionMs = (ms) => (reducedMotion.matches ? 1 : ms);

export function createView3D(container, data, store, tooltip, audio) {
	const stage = container.parentElement;
	let ctx = null;
	let ready = null;
	// Zoom readout (the dock's zoom menu): told whenever the zoom level changes.
	let zoomListener = null;
	let lastZoom = 0;
	let running = false;
	let raf = 0;
	const ui = {
		quality: getQuality(),
		sky: null, // null = follow the page theme
		comparing: false,
		links: false,
		compareIndex: Math.max(0, data.months.indexOf("2014-09")),
		replaying: false,
		follow: false,
	};

	const controls = createControls3D(stage, data, {
		replay: () => (ui.replaying ? stopReplay() : startReplay()),
		follow: () => {
			ui.follow = !ui.follow;
			if (ctx) ctx.followNow();
			syncControls();
		},
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
		const snow = createSnow(THREE, terrain.grid);
		await step(0.8, "Placing dams and rivers…");
		const shared = waterUniforms(THREE);
		const lakes = createLakes(THREE, basins, shared);
		const ocean = createOcean(THREE, shared);
		const dams = createDams(THREE, data, basins, world, ui.quality);
		const links = createGaugeLinks(THREE, data, world, basins);
		const outflow = createOutflow(THREE, basins, dams, world, shared, ui.quality);
		const pulses = createPulses(THREE, outflow.outflowLines(), { perLine: ui.quality === "low" ? 4 : 8 });
		outflow.group.add(pulses.points);
		// Meltwater: in the melt months (April to July) pale pulses run down each mountain
		// reservoir's inflow river, as many and as fast as its section's snowpack fell that month.
		const SECTION_OF = (lat) => (lat >= 39.35 ? "north" : lat >= 37.55 ? "central" : "south");
		const meltLines = outflow.inflowLines().filter((l) => {
			const r = basins.basins[l.dam].r;
			const p = l.pts[0];
			return r.lat >= 35.4 && world.metresAt(...world.unproject(p[0], p[2])) >= 350;
		});
		const meltDams = new Set(meltLines.map((l) => l.dam));
		const melt = createPulses(THREE, meltLines, { perLine: ui.quality === "low" ? 4 : 7 });
		melt.points.material.uniforms.uColor.value.set("#f2fbff");
		let meltRel = basins.basins.map(() => 0);
		// Snow lost over month i (1st of the month to the 1st of the next) in a section, 0..1.
		const meltAt = (i) => basins.basins.map((b, di) => {
			const cm = data.calMonth[i];
			if (!meltDams.has(di) || cm < 3 || cm > 6 || i + 1 >= data.months.length) return 0;
			const series = data.snow[SECTION_OF(b.r.lat)];
			const a = series[i];
			const z = series[i + 1];
			if (a === null || z === null) return 0;
			return Math.min(1, Math.max(0, a - z) / 70);
		});
		const mainRivers = createMainRivers(THREE, world, outflow.router, shared, basins);
		const riparian = createRiparian(THREE, outflow, outflow.router, basins, world, ui.quality);
		// Waterbirds, vultures, deer and cattle round each dam, for close views (High quality only).
		const wildlife = createWildlife(THREE, { basins, dams, outflow, router: outflow.router, world, riparian, shared, quality: ui.quality });
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
		// Scale bar: kilometres per pixel at the orbit target, from the camera distance and fov.
		const scaleBar = document.createElement("div");
		scaleBar.className = "scale-bar";
		scaleBar.setAttribute("aria-hidden", "true");
		scaleBar.innerHTML = "<span class=\"scale-line\"></span><span class=\"scale-text\"></span>";
		container.appendChild(scaleBar);
		let scaleKey = "";
		const north = [ new THREE.Vector3(), new THREE.Vector3() ];
		let northDeg = null;
		const snapshot = createSnapshots(data, basins, dams.foam.spots);
		dams.foam.uniforms.uTime = shared.uTime;
		dams.foam.mesh.material.uniforms.uTime = shared.uTime;
		// Everything on the ground sits in one group whose vertical scale follows the zoom: the
		// overview keeps its relief exaggeration so the Sierra reads, a close view comes down to
		// near true scale so foothills are not sheer cliffs. CPU heights are scaled by vScale.
		const land = new THREE.Group();
		// Riparian trees hide themselves by camera height, so the Layers toggle uses a wrapper.
		const forest = new THREE.Group();
		forest.add(riparian.group);
		land.add(terrain.group, snow.mesh, melt.points, ocean.mesh, lakes.mesh, dams.mesh, dams.foam.mesh, links.group, outflow.group, forest, mainRivers.mesh, wildlife.group);
		// Layers panel: each name switches real scene objects (or the DOM label layer).
		const layerObjs = {
			terrain: [ terrain.group ],
			reservoirs: [ lakes.mesh ],
			rivers: [ outflow.group, mainRivers.mesh ],
			forest: [ forest, wildlife.wild ],
			dams: [ dams.mesh, dams.foam.mesh ],
			snow: [ snow.mesh ],
		};
		sc.scene.add(sky.mesh, land);
		let vScale = 1;
		const NEAR_EXAG = 1.6;
		const scaleFor = (d) => {
			const t = Math.min(1, Math.max(0, (Math.log(d) - Math.log(12)) / (Math.log(320) - Math.log(12))));
			return (NEAR_EXAG + (EXAGGERATION - NEAR_EXAG) * t * t * (3 - 2 * t)) / EXAGGERATION;
		};
		function fitScale() {
			const k = scaleFor(sc.camera.position.distanceTo(sc.controls.target));
			if (Math.abs(k - vScale) < 1e-4) return;
			const r = k / vScale;
			sc.controls.target.y *= r;
			sc.camera.position.y *= r;
			vScale = k;
			land.scale.y = k;
			land.updateMatrixWorld(true);
			riparian.setUnsquash(1 / k);
			wildlife.setUnsquash(1 / k);
		}

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
		land.add(pick);

		// Animated state starts at the current month.
		const s0 = snapshot(store.get().dateIndex);
		const cur = { levels: [ ...s0.levels ], foam: [ ...s0.foam ], outlet: [ ...s0.outlet ], spill: [ ...s0.spill ], dryness: s0.dryness, gold: s0.gold };
		let target = s0;
		let fxLevel = 0;
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
			snow.setNight(nightV);
			mainRivers.setNight(nightV);
			return p;
		};
		let preset = usePreset(skyName());

		function applyState(state, snap) {
			lakes.apply(state.levels, snap.tints, snap.visible);
			dams.foam.apply(state.foam);
			outflow.apply(state.outlet, state.spill);
			outflow.setLevels(state.levels);
			terrain.setDryness(state.dryness);
			terrain.setGold(state.gold);
			mainRivers.setFlow(1 - state.dryness);
			wildlife.setLevels(state.levels, snap.visible);
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
			cancelFollow();
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
			} else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
				// Keyboard zoom, with the same tilt toward an oblique view as the wheel and pinch.
				e.preventDefault();
				zoomBy(e.key === "+" || e.key === "=" ? 0.7 : 1 / 0.7);
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

		sc.controls.addEventListener("start", () => {
			dragging = true;
			mover = null;
			zoom.active = false;
			tooltip.hide();
		});
		sc.controls.addEventListener("end", () => {
			dragging = false;
		});

		// Fly in to frame the dam with its lake behind it, from the downstream side.
		function focusPose(id) {
			const b = basins.byId.get(id);
			const info = dams.info.get(id);
			// From downstream and to one side; take the side that has the sun across the view from
			// a little behind the camera, so the dam face and the canyon are modelled by light.
			const sunD = sc.sun.userData.dir;
			const sl = Math.hypot(sunD.x, sunD.z) || 1;
			let dir = null;
			let bestScore = -Infinity;
			for (const side of [ 0.5, -0.5, 0.85, -0.85 ]) {
				const c = [ -b.eu[0] * 0.85 + b.ev[0] * side, -b.eu[1] * 0.85 + b.ev[1] * side ];
				const cl = Math.hypot(c[0], c[1]);
				const along = (c[0] * sunD.x + c[1] * sunD.z) / (cl * sl);
				const score = -Math.pow(along - 0.35, 2) - Math.abs(side) * 0.15;
				if (score > bestScore) {
					bestScore = score;
					dir = c;
				}
			}
			const [ dx, dz ] = info.center;
			// Far enough to take in the dam, most of the lake behind it and the river below.
			const dist = 6 + Math.max(info.halfWidth * 2.5, b.Lu * 1.1);
			const k = scaleFor(dist);
			const target = [ dx + (b.cx - dx) * 0.4, (info.crest - info.height * 0.35) * k, dz + (b.cz - dz) * 0.4 ];
			const relief = Math.max(0, ringGround(target[0], target[2], Math.max(4, dist * 0.6)) / vScale * k - target[1]) / dist;
			return { target, dist, polar: polarFor(dist, relief), az: Math.atan2(dir[0], dir[1]) };
		}
		function focus(id) {
			if (!basins.byId.get(id)) return;
			mover = flyTo(THREE, sc.camera, sc.controls, focusPose(id), motionMs(1500));
			audio.whoosh();
		}

		// Ground under a point: carved basin surface if any, else the DEM; never below the sea plane.
		const groundAt = (x, z) => {
			const s = basins.surfaceAt(x, z);
			return Math.max(0.3, s ? s.h : world.groundY(x, z)) * vScale;
		};
		// Top of what is drawn at a point: the ground, or a lake's water where it covers the bed.
		// k is the vertical scale to use (the current one, or one a zoom step is about to reach).
		const lakeIdx = new Map(basins.basins.map((b, i) => [ b.r.id, i ]));
		// Drought front, flares and the dated path (three/droughtFx.js); Layers switch the first and last.
		const fxLayer = { front: true, path: true };
		const drought = createDroughtFx(THREE, {
			data, basins, world, container, labels, terrain, shared, quality: ui.quality, layer: fxLayer,
			groundLocal: (x, z) => groundAt(x, z) / vScale,
			vScale: () => vScale,
			reduced: () => reducedMotion.matches,
		});
		land.add(drought.dustPts, drought.pathGroup);
		const topAt = (x, z, k = vScale) => {
			const s = basins.surfaceAt(x, z);
			let h = s ? s.h : world.groundY(x, z);
			if (s && lakeIdx.has(s.basinId)) h = Math.max(h, cur.levels[lakeIdx.get(s.basinId)]);
			return Math.max(0.3, h) * k;
		};
		// Keep the camera above the terrain and its view of the target clear: sample the
		// ground along the sight line and lift the camera until every sample is above it.
		const CLEAR_F = [ 1, 0.93, 0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22 ];
		// Highest ground in a ring round a point (not just under it): canyon rims count.
		const RING = Array.from({ length: 12 }, (_, k) => [ Math.cos(k * Math.PI / 6), Math.sin(k * Math.PI / 6) ]);
		function ringGround(x, z, r, at = groundAt) {
			let g = at(x, z);
			for (const [ cx, cz ] of RING) g = Math.max(g, at(x + cx * r, z + cz * r), at(x + cx * r * 0.5, z + cz * r * 0.5));
			return g;
		}
		// Lowest camera height for a camera at p looking at t, with the ground (and water) at
		// vertical scale k. Pure, so a zoom step can test a pose before taking it.
		function needAt(p, t, k = vScale) {
			const top = (x, z) => topAt(x, z, k);
			const dist = p.distanceTo(t);
			const margin = 1.5 + dist * 0.05;
			// Close in, stay well above the local terrain: at least 40% of the distance to the
			// target above the highest ground round the camera, so a view never sits beside cliffs.
			let need = dist < 120 ? ringGround(p.x, p.z, Math.max(3, dist * 0.35), top) + dist * 0.4 : -Infinity;
			for (const f of CLEAR_F) {
				const x = t.x + (p.x - t.x) * f;
				const z = t.z + (p.z - t.z) * f;
				let g = top(x, z);
				if (f === 1) for (const [ ox, oz ] of [ [ 2, 0 ], [ -2, 0 ], [ 0, 2 ], [ 0, -2 ] ]) g = Math.max(g, top(x + ox, z + oz));
				need = Math.max(need, t.y + (g + margin * f - t.y) / f);
			}
			return need;
		}
		function keepAbove() {
			const p = sc.camera.position;
			const need = needAt(p, sc.controls.target);
			if (need > p.y) p.y = need;
			return need;
		}

		// Zooming in tilts toward a low, oblique view (about 35 degrees above the horizon);
		// zooming out tilts toward looking down on the state.
		// In steep country (high ground round the target) look down more steeply, up to about
		// 50 degrees, so canyon walls do not fill the view.
		const reliefAt = (d) => {
			const t = sc.controls.target;
			return Math.max(0, ringGround(t.x, t.z, Math.max(4, d * 0.6)) - t.y) / Math.max(1, d);
		};
		const polarFor = (d, relief = 0) => {
			const t = Math.min(1, Math.max(0, (Math.log(d) - Math.log(40)) / (Math.log(1600) - Math.log(40))));
			const base = 0.96 - 0.34 * t * t * (3 - 2 * t);
			return Math.max(0.62, base - Math.min(0.34, relief * 1.1) * (1 - t));
		};
		// Smooth zoom. Wheel, trackpad, pinch, double-click and + / - all set a goal distance;
		// each frame the camera eases toward it (exponential, about 75 ms, at most 12% a frame),
		// scaling about the ground point under the pointer. Tilt follows the eased distance, one
		// way per zoom direction and rate-limited. A step that would take the camera too close to
		// the ground is shortened (never undone), so zoom comes to rest at the terrain instead
		// of bouncing off it. After every other adjustment (relief scale, ground lift) the view
		// slides so the anchor point lands back under the pointer. Idle frames do nothing.
		sc.controls.enableZoom = false;
		const sph = new THREE.Spherical();
		const off = new THREE.Vector3();
		const zp = new THREE.Vector3();
		const zt = new THREE.Vector3();
		const za = new THREE.Vector3();
		const zaxis = new THREE.Vector3();
		const zquat = new THREE.Quaternion();
		// anchor: land-local (unscaled y) ground point; px: the client pixel it is held under.
		const zoom = { goal: 0, anchor: new THREE.Vector3(), px: [ 0, 0 ], active: false, held: false, relief: 0, k: 1 };
		const ZOOM_TAU = 0.075;
		const ZOOM_STEP = 0.12;
		const TILT_MAX = 0.012;
		function groundUnder(cx, cy) {
			const r = canvas.getBoundingClientRect();
			ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
			sc.camera.updateMatrixWorld();
			raycaster.setFromCamera(ndc, sc.camera);
			const o = raycaster.ray.origin;
			const d = raycaster.ray.direction;
			if (d.y >= -0.01) return null;
			const far = sc.camera.position.distanceTo(sc.controls.target) * 4;
			const below = (t) => o.y + d.y * t <= topAt(o.x + d.x * t, o.z + d.z * t);
			let prev = 0;
			for (let n = 1; n <= 200; n++) {
				const t = (far * n) / 200;
				if (below(t)) {
					let lo = prev;
					let hi = t;
					for (let it = 0; it < 14; it++) {
						const mid = (lo + hi) / 2;
						if (below(mid)) hi = mid;
						else lo = mid;
					}
					return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
				}
				prev = t;
			}
			return null;
		}
		// Returns false at a zoom limit (nothing to do), so the page may scroll on instead.
		function zoomBy(factor, cx = null, cy = null) {
			const d = sc.camera.position.distanceTo(sc.controls.target);
			const base = zoom.active ? zoom.goal : d;
			const goal = Math.min(sc.controls.maxDistance, Math.max(sc.controls.minDistance, base * factor));
			if (Math.abs(Math.log(goal / base)) < 1e-4) return false;
			const r = canvas.getBoundingClientRect();
			const x = cx ?? r.left + r.width / 2;
			const y = cy ?? r.top + r.height / 2;
			// Repeat notches at the same pixel keep their anchor; re-picking it adds jitter.
			if (!(zoom.active && Math.hypot(x - zoom.px[0], y - zoom.px[1]) <= 1)) {
				const a = groundUnder(x, y);
				if (a) {
					zoom.anchor.set(a.x, a.y / vScale, a.z);
					zoom.px = [ x, y ];
				} else {
					// No ground under the pointer (sky): zoom about the target, held at the centre.
					const t = sc.controls.target;
					zoom.anchor.set(t.x, t.y / vScale, t.z);
					zoom.px = [ r.left + r.width / 2, r.top + r.height / 2 ];
				}
			}
			if (!zoom.active) zoom.relief = reliefAt(d);
			zoom.goal = goal;
			zoom.active = true;
			mover = null;
			return true;
		}
		// The pose one zoom step of factor s would give, written to zp / zt; true if it clears the ground.
		function zoomPose(s, step) {
			const p = sc.camera.position;
			const t = sc.controls.target;
			const phi0 = Math.acos(Math.max(-1, Math.min(1, (p.y - t.y) / Math.max(1e-9, p.distanceTo(t)))));
			za.set(zoom.anchor.x, zoom.anchor.y * vScale, zoom.anchor.z);
			zp.copy(p).sub(za).multiplyScalar(s).add(za);
			zt.copy(t).sub(za).multiplyScalar(s).add(za);
			// Tilt toward the view for this distance, only ever one way per zoom direction.
			off.copy(zp).sub(zt);
			sph.setFromVector3(off);
			const want = Math.min(sc.controls.maxPolarAngle, polarFor(sph.radius, zoom.relief));
			let dphi = Math.max(-TILT_MAX, Math.min(TILT_MAX, (want - sph.phi) * Math.min(1, Math.abs(step) * 2.2)));
			dphi = step < 0 ? Math.max(0, dphi) : Math.min(0, dphi);
			dphi = Math.min(dphi, sc.controls.maxPolarAngle - sph.phi);
			if (dphi !== 0) {
				// Rotate the whole view about the camera's right axis through the anchor: the polar
				// angle changes by exactly dphi and the anchor keeps its place on screen.
				zaxis.set(off.z, 0, -off.x).normalize();
				zquat.setFromAxisAngle(zaxis, dphi);
				zp.sub(za).applyQuaternion(zquat).add(za);
				zt.sub(za).applyQuaternion(zquat).add(za);
			}
			sph.radius = zp.distanceTo(zt);
			// The relief scale this distance will bring.
			const k = scaleFor(sph.radius);
			zoom.k = k;
			zp.y *= k / vScale;
			zt.y *= k / vScale;
			za.y *= k / vScale;
			if (step > 0) {
				capTilt(phi0);
				return true;
			}
			// Close over high ground, look down more to stay clear of it (as keepAbove would),
			// but by turning about the anchor, a little a frame, so the anchor stays put.
			let turned = 0;
			for (let it = 0; it < 3; it++) {
				const lack = needAt(zp, zt, k) - zp.y;
				if (lack <= 1e-3) break;
				const hd = Math.max(1, Math.hypot(zp.x - za.x, zp.z - za.z));
				const dphi = Math.max(-(TILT_MAX - turned), -lack / hd * 1.1);
				if (dphi > -1e-5 || sph.phi + dphi - turned < 0.2) break;
				off.copy(zp).sub(zt);
				zaxis.set(off.z, 0, -off.x).normalize();
				zquat.setFromAxisAngle(zaxis, dphi);
				zp.sub(za).applyQuaternion(zquat).add(za);
				zt.sub(za).applyQuaternion(zquat).add(za);
				turned -= dphi;
			}
			// A long frame (large step) must not tilt more than a frame's worth.
			capTilt(phi0);
			return needAt(zp, zt, k) <= zp.y + 1e-3;
		}
		// Everything one zoom step does to the tilt (the eased tilt, the clearance turn and the
		// relief rescale, which steepens or flattens the sight line) adds up to at most TILT_MAX
		// a frame: any excess is turned back about the anchor, so the anchor keeps its place.
		// A step that then sits too low is shortened by the caller, so a slow frame cannot jump.
		function capTilt(phi0) {
			off.copy(zp).sub(zt);
			const phi = Math.acos(Math.max(-1, Math.min(1, off.y / Math.max(1e-9, off.length()))));
			const excess = phi - phi0 - Math.max(-TILT_MAX, Math.min(TILT_MAX, phi - phi0));
			if (Math.abs(excess) < 1e-6) return;
			zaxis.set(off.z, 0, -off.x).normalize();
			zquat.setFromAxisAngle(zaxis, -excess);
			zp.sub(za).applyQuaternion(zquat).add(za);
			zt.sub(za).applyQuaternion(zquat).add(za);
		}
		function stepZoom(dt) {
			zoom.held = false;
			if (!zoom.active) return;
			if (replayFn || mover) {
				zoom.active = false;
				return;
			}
			const d = sc.camera.position.distanceTo(sc.controls.target);
			const gap = Math.log(zoom.goal / d);
			if (Math.abs(gap) < 2e-3) {
				zoom.active = false;
				return;
			}
			zoom.relief += (reliefAt(d) - zoom.relief) * (1 - Math.exp(-dt / 0.25));
			let step = Math.max(-ZOOM_STEP, Math.min(ZOOM_STEP, gap * (1 - Math.exp(-dt / ZOOM_TAU))));
			if (!zoomPose(Math.exp(step), step)) {
				// Too close to the ground: take the largest part of the step that clears it.
				let lo = 0;
				let hi = step;
				for (let it = 0; it < 7; it++) {
					const mid = (lo + hi) / 2;
					if (zoomPose(Math.exp(mid), mid)) lo = mid;
					else hi = mid;
				}
				step = lo;
				if (step > -2e-4) {
					// At rest on the ground: as close as this spot allows.
					zoom.goal = d;
					zoom.active = false;
					return;
				}
				zoomPose(Math.exp(step), step);
			}
			// Undo the relief rescale (fitScale applies it after the controls update).
			const k = zoom.k;
			zp.y *= vScale / k;
			zt.y *= vScale / k;
			sc.camera.position.copy(zp);
			sc.controls.target.copy(zt);
			zoom.held = true;
		}
		// Slide the view sideways so the zoom's anchor point is back under its pixel.
		function holdAnchor() {
			if (!zoom.held) return;
			sc.camera.lookAt(sc.controls.target);
			sc.camera.updateMatrixWorld();
			const r = canvas.getBoundingClientRect();
			ndc.set(((zoom.px[0] - r.left) / r.width) * 2 - 1, -((zoom.px[1] - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(ndc, sc.camera);
			const o = raycaster.ray.origin;
			const dir = raycaster.ray.direction;
			const ay = zoom.anchor.y * vScale;
			if (dir.y > -0.02 || o.y <= ay) return;
			const h = (ay - o.y) / dir.y;
			off.set(zoom.anchor.x - (o.x + dir.x * h), 0, zoom.anchor.z - (o.z + dir.z * h));
			const p = sc.camera.position;
			const t = sc.controls.target;
			p.add(off);
			t.add(off);
			// Still too low (the slide or the relief change): look down more, turning about the
			// anchor so it stays under the pointer and the distance is unchanged, not a lift.
			za.set(zoom.anchor.x, ay, zoom.anchor.z);
			for (let it = 0; it < 3; it++) {
				const lack = needAt(p, t) - p.y;
				if (lack <= 1e-3) break;
				off.copy(p).sub(t);
				zaxis.set(off.z, 0, -off.x).normalize();
				zquat.setFromAxisAngle(zaxis, -lack / Math.max(1, Math.hypot(p.x - za.x, p.z - za.z)) * 1.05);
				p.sub(za).applyQuaternion(zquat).add(za);
				t.sub(za).applyQuaternion(zquat).add(za);
			}
			sc.camera.lookAt(t);
		}
		canvas.addEventListener("wheel", (e) => {
			cancelFollow();
			if (ui.replaying) return;
			// Normalise lines and pages to pixels; a macOS trackpad pinch arrives as small
			// ctrl+wheel deltas, so it is scaled up to match a wheel notch.
			let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
			if (e.ctrlKey) dy *= 3.5;
			dy = Math.max(-250, Math.min(250, dy));
			const moved = zoomBy(Math.exp(dy * 0.00095), e.clientX, e.clientY);
			// At a zoom limit the wheel scrolls the page on, so nobody is trapped over the map
			// (a pinch never scrolls or zooms the page).
			if (moved || e.ctrlKey) e.preventDefault();
		}, { passive: false });
		// Safari trackpad pinch arrives as WebKit gesture events (scale), not ctrl+wheel. On iOS a
		// touch pinch fires these too; the touch handler below zooms then, so they are skipped.
		let gesture = 0;
		canvas.addEventListener("gesturestart", (e) => {
			e.preventDefault();
			gesture = e.scale || 1;
		}, { passive: false });
		canvas.addEventListener("gesturechange", (e) => {
			e.preventDefault();
			if (gesture && e.scale > 0 && !pinch && !ui.replaying) zoomBy(gesture / e.scale, e.clientX, e.clientY);
			gesture = e.scale || gesture;
		}, { passive: false });
		canvas.addEventListener("gestureend", (e) => {
			e.preventDefault();
			gesture = 0;
		}, { passive: false });
		canvas.addEventListener("dblclick", (e) => {
			if (!ui.replaying) zoomBy(0.5, e.clientX, e.clientY);
		});
		// Touch pinch, centred between the fingers. A two-finger pan only becomes a zoom once the
		// fingers have spread or closed by more than about 6%.
		let pinch = null;
		const span = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
		canvas.addEventListener("touchstart", (e) => {
			pinch = e.touches.length === 2 ? { d0: span(e.touches), last: span(e.touches), on: false } : null;
		}, { passive: true });
		canvas.addEventListener("touchmove", (e) => {
			if (!pinch || e.touches.length !== 2 || ui.replaying) return;
			const d = span(e.touches);
			if (!pinch.on && Math.abs(Math.log(d / pinch.d0)) > 0.06) pinch.on = true;
			if (pinch.on) cancelFollow();
			if (pinch.on && d > 0) zoomBy(pinch.last / d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
			pinch.last = d;
		}, { passive: true });
		canvas.addEventListener("touchend", (e) => {
			if (e.touches.length < 2) pinch = null;
		}, { passive: true });
		// The near plane follows the camera distance: close views keep depth precision (no
		// z-fighting between ground, water and rivers), far views keep the whole state.
		function fitNear() {
			const d = sc.camera.position.distanceTo(sc.controls.target);
			const near = Math.min(2, Math.max(0.1, d * 0.012));
			if (Math.abs(near - sc.camera.near) > sc.camera.near * 0.1) {
				sc.camera.near = near;
				sc.camera.updateProjectionMatrix();
			}
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
					// With Follow on, the follow moves steer the camera instead of the fixed path.
					if (!following()) {
						sc.controls.target.set(...p.target);
						sc.camera.position.copy(poseToPosition(THREE, p));
					}
					const idx = Math.min(data.months.length - 1, Math.floor(t * (data.months.length - 1) + 0.0001));
					if (idx !== store.get().dateIndex) store.set({ dateIndex: idx });
				}
			}
			if (mover && (!replayFn || following()) && mover(now)) mover = null;
			stepZoom(dt);
			sc.controls.update();
			fitScale();
			holdAnchor();
			keepAbove();
			sc.camera.lookAt(sc.controls.target);
			fitNear();
			const zf = home().dist / sc.camera.position.distanceTo(sc.controls.target);
			if (zoomListener && Math.abs(zf - lastZoom) > lastZoom * 0.003) {
				lastZoom = zf;
				zoomListener(zf);
			}
			if (shared.uLift.value > 0) {
				// Keep the moon low in front of the camera so lakes show its reflection path.
				// Its elevation matches the view's pitch, so the path runs through the middle of the view.
				const f = sc.controls.target.clone().sub(sc.camera.position);
				const h = Math.hypot(f.x, f.z) || 1;
				const el = Math.min(0.9, Math.max(0.15, Math.atan2(-f.y, h)));
				shared.uMoonDir.value.set(f.x / h * Math.cos(el), Math.sin(el), f.z / h * Math.cos(el));
			}
			riparian.update(sc.camera, groundAt(sc.camera.position.x, sc.camera.position.z));
			wildlife.update(sc.camera, groundAt(sc.camera.position.x, sc.camera.position.z), vScale, shared.uTime.value, container.clientHeight);
			sc.updateSun();

			// Ease toward the target month.
			// Reduced motion: each month shows at once, no tween.
			const k = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 4.5);
			for (let i = 0; i < cur.levels.length; i++) cur.levels[i] += (target.levels[i] - cur.levels[i]) * k;
			for (let i = 0; i < cur.foam.length; i++) cur.foam[i] += (target.foam[i] - cur.foam[i]) * k;
			for (let i = 0; i < cur.outlet.length; i++) {
				cur.outlet[i] += (target.outlet[i] - cur.outlet[i]) * k;
				cur.spill[i] += (target.spill[i] - cur.spill[i]) * k;
			}
			fxLevel = runEvent(now);
			pulses.update(dt, cur.outlet, outflow.group.visible && !reducedMotion.matches);
			snow.update(reducedMotion.matches ? 1 : k * 0.7);
			melt.update(dt, meltRel, snow.mesh.visible && !reducedMotion.matches);
			placeRecord();
			drought.update(dt, now, sc.camera);
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
			{
				const dist = sc.camera.position.distanceTo(sc.controls.target);
				const pxPerUnit = h / (2 * dist * Math.tan((sc.camera.fov * Math.PI) / 360));
				const kmPerPx = 1 / (world.unitsPerKm * pxPerUnit);
				const raw = kmPerPx * 90;
				const pow = 10 ** Math.floor(Math.log10(raw));
				const nice = [ 1, 2, 5, 10 ].map((k) => k * pow).filter((v) => v <= raw).pop() ?? pow;
				const key = `${nice}|${Math.round(nice / kmPerPx)}`;
				if (key !== scaleKey) {
					scaleKey = key;
					scaleBar.firstChild.style.width = `${Math.round(nice / kmPerPx)}px`;
					scaleBar.lastChild.textContent = `${nice >= 1 ? nice : nice.toFixed(1)} km`;
				}
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
				labels.update(sc.camera, w, h, store.get().selected ?? hovered, false, sc.controls.target, groundAt, reachScale, halves[1], avoid, vScale);
			} else {
				if (labelsLeft) labelsLeft.update(sc.camera, w, h, null, true);
				labels.update(sc.camera, w, h, store.get().selected ?? hovered, false, sc.controls.target, groundAt, reachScale, null, [], vScale);
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

		// Record-low marker: in the month a lake reaches its lowest storage in the data, a quiet ring
		// settles on it with its % full. It stays its full few seconds on its own timer, also while
		// the replay plays on through later months (one at a time: a newer record replaces it); a
		// month picked by hand clears it.
		const recordAt = new Map();
		for (const b of basins.basins) {
			const r = b.r;
			if (r.floodControl || !r.hasData) continue;
			let lo = -1;
			r.series.forEach((v, i) => {
				if (v !== null && !(r.filled && r.filled[i]) && (lo < 0 || v < r.series[lo])) lo = i;
			});
			if (lo >= 0) recordAt.set(lo, [ ...(recordAt.get(lo) ?? []), r ].sort((a, c) => c.capacity - a.capacity));
		}
		const sinceYear = data.months[0].slice(0, 4);
		const record = document.createElement("div");
		record.className = "record-low";
		record.innerHTML = "<span class=\"record-ring\"></span><span class=\"record-text\"></span>";
		container.appendChild(record);
		let recordTimer = 0;
		const shortName = (n) => n.replace(/\s*\(.*?\)/g, "").replace(/ (Dam|Reservoir|Lake)$/, "").replace(/^Lake /, "").replace(/ Dam .*$/, "");
		function hideRecord() {
			clearTimeout(recordTimer);
			record.classList.remove("on");
			undimLabels();
		}
		function showRecord(i) {
			const r = recordAt.get(i)?.[0];
			if (!r) {
				if (!store.get().playing) hideRecord();
				return;
			}
			hideRecord();
			record.dataset.id = r.id;
			record.querySelector(".record-text").textContent = `${shortName(r.name)} ${Math.round(r.series[i] / r.capacity * 100)}%, lowest since ${sinceYear}`;
			// Restart the settle animation.
			void record.offsetWidth;
			record.classList.add("on");
			recordTimer = setTimeout(hideRecord, 4500);
		}
		// Lake names the record label could not get clear of are dimmed while it shows.
		let dimmed = [];
		function undimLabels() {
			for (const el of dimmed) el.classList.remove("under-record");
			dimmed = [];
		}
		const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
		function placeRecord() {
			const id = record.dataset.id;
			if (!id || !record.classList.contains("on")) return;
			const b = basins.byId.get(id);
			v3.set(b.cx, b.levelFor(0.3) * vScale, b.cz).project(sc.camera);
			const off = v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1;
			record.style.visibility = off ? "hidden" : "";
			const x = (v3.x + 1) / 2 * container.clientWidth;
			// The label sits below the ring, slid sideways to stay inside the view.
			// The label sits below the ring, or above or to the left of it when that keeps it clear
			// of the lake names; slid sideways to stay inside the view.
			const y = (1 - v3.y) / 2 * container.clientHeight;
			const text = record.lastChild;
			const tw = text.offsetWidth;
			const th = text.offsetHeight;
			const cw = container.clientWidth;
			const clampX = (lx) => Math.min(cw - tw - 6, Math.max(6, lx));
			const spots = [ [ clampX(x + 20 - tw * 0.3), y + 28 ], [ clampX(x + 20 - tw * 0.3), y - 28 - th ], [ clampX(x - 30 - tw), y + 28 ], [ clampX(x + 30), y - 28 - th ] ];
			const cr = container.getBoundingClientRect();
			const names = [ ...labels.layer.querySelectorAll(".lbl-text:not(.far)") ].filter((el) => el.closest(".lbl").style.display !== "none").map((el) => {
				const r = el.getBoundingClientRect();
				return { el, left: r.left - cr.left - 3, right: r.right - cr.left + 3, top: r.top - cr.top - 3, bottom: r.bottom - cr.top + 3 };
			});
			const hits = ([ lx, ly ]) => names.filter((n) => overlaps(n, { left: lx, right: lx + tw, top: ly, bottom: ly + th }));
			let best = spots[0];
			let bestHits = hits(best);
			for (const sp of spots.slice(1)) {
				if (!bestHits.length) break;
				const h2 = hits(sp);
				if (h2.length < bestHits.length) {
					best = sp;
					bestHits = h2;
				}
			}
			text.style.left = `${(best[0] - x).toFixed(1)}px`;
			text.style.top = `${(best[1] - y).toFixed(1)}px`;
			const under = bestHits.map((n) => n.el);
			for (const el of dimmed) if (!under.includes(el)) el.classList.remove("under-record");
			for (const el of under) el.classList.add("under-record");
			dimmed = under;
			record.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
		}

		// Event moments, a few seconds each and only in their month: Feb 2017, white water bursting
		// down Oroville's spillway chute; Jan 2023, a translucent rain band sweeping north to south.
		const EVENT_MS = 4200;
		const eventMonths = { oroville: data.months.indexOf("2017-02"), rain: data.months.indexOf("2023-01") };
		const oroIdx = basins.basins.findIndex((b) => b.r.id === "ORO");
		const [ bandX0, bandN ] = world.project([ -124.6, 42.1 ]);
		const [ bandX1, bandS ] = world.project([ -114.0, 32.4 ]);
		const bandDepth = (bandS - bandN) * 0.14;
		const rainMat = new THREE.ShaderMaterial({
			vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
			fragmentShader: `
				uniform float uA; uniform float uTime; uniform vec3 uColor; uniform vec3 uStreak; varying vec2 vUv;
				float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
				void main() {
					// A storm-blue band, darker than the tan valley and the Sierra so it reads over both,
					// with pale wind-slanted streaks falling within it; ragged soft edges.
					float edge = 0.08 * (h(vec2(floor(vUv.x * 60.0), 3.0)) - 0.5);
					float band = smoothstep(0.0, 0.42, vUv.y + edge) * smoothstep(1.0, 0.58, vUv.y - edge);
					float sx = vUv.x * 360.0 + vUv.y * 9.0;
					float col = floor(sx);
					float thin = smoothstep(0.5, 0.15, abs(fract(sx) - 0.5));
					float streak = step(0.55, h(vec2(col, 1.0))) * thin * smoothstep(0.55, 1.0, fract(vUv.y * 7.0 + uTime * (1.4 + h(vec2(col, 2.0)))));
					vec3 c = mix(uColor, uStreak, streak);
					gl_FragColor = vec4(c, uA * band * (0.55 + 0.35 * streak));
				}`,
			uniforms: { uA: { value: 0 }, uTime: shared.uTime, uColor: { value: new THREE.Color("#2b5d8c") }, uStreak: { value: new THREE.Color("#e4f1fb") } },
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		// A horizontal band of rain lying over the state, crossing it from north to south.
		const rain = new THREE.Mesh(new THREE.PlaneGeometry(bandX1 - bandX0, bandDepth), rainMat);
		rain.rotation.x = -Math.PI / 2;
		rain.position.set((bandX0 + bandX1) / 2, 40, bandN);
		rain.visible = false;
		rain.renderOrder = 4;
		sc.scene.add(rain);
		let fx = null;
		function startEvent(i) {
			fx = null;
			rain.visible = false;
			if (reducedMotion.matches) return;
			if (i === eventMonths.oroville && oroIdx >= 0) fx = { name: "oroville", t0: performance.now() };
			else if (i === eventMonths.rain) fx = { name: "rain", t0: performance.now() };
		}
		// Envelope 0..1 over the event: quick rise, hold, slow fade.
		function runEvent(now) {
			if (!fx) return 0;
			const t = (now - fx.t0) / EVENT_MS;
			if (t >= 1) {
				fx = null;
				rain.visible = false;
				return 0;
			}
			const env = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.35);
			if (fx.name === "oroville") cur.spill[oroIdx] = Math.max(cur.spill[oroIdx], env);
			else {
				rain.visible = true;
				rain.position.z = bandN - bandDepth / 2 + (bandS - bandN + bandDepth) * t;
				rainMat.uniforms.uA.value = env;
			}
			return env;
		}

		// Camera follow: while the timeline or the drought replay plays, glide to the largest
		// reservoir furthest below its average that month, hold there, and pull back to the state
		// view each October (a new water year) and at the end. Any drag or zoom turns it off.
		const following = () => ui.follow && !reducedMotion.matches;
		let followId = null;
		function followTo(i) {
			if (!following() || !(store.get().playing || ui.replaying)) return;
			const d = driestAt(data, i);
			const back = data.calMonth[i] === 9 || i >= data.months.length - 1 || !d;
			const id = back ? "home" : d.r.id;
			if (id === followId) return;
			followId = id;
			if (back) {
				mover = flyTo(THREE, sc.camera, sc.controls, home(), 1800);
				return;
			}
			const b = basins.byId.get(id);
			const dist = home().dist * 0.4;
			mover = flyTo(THREE, sc.camera, sc.controls, { target: [ b.cx, (b.P - 2) * scaleFor(dist), b.cz ], dist, polar: 0.98, az: poseOf(THREE, sc.camera, sc.controls).az }, 1800);
		}
		function cancelFollow() {
			if (!ui.follow) return;
			ui.follow = false;
			followId = null;
			mover = null;
			syncControls();
		}

		function setMonth(i) {
			startEvent(i);
			drought.setMonth(i, store.get().playing || ui.replaying);
			followTo(i);
			showRecord(i);
			target = snapshot(i);
			snow.setTarget([ data.snow.north[i], data.snow.central[i], data.snow.south[i] ]);
			meltRel = meltAt(i);
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
			// Elevation profile of the river drawn below a dam: distance downstream (km) and the
			// terrain's own DEM height (metres, ETOPO1 as the 3D ground uses it) at each point of
			// the line. Null when the dam has no drawn river.
			riverProfile(id) {
				const di = lakeIdx.get(id);
				if (di === undefined) return null;
				const { pts, via, ending } = outflow.riverPath(di);
				if (pts.length < 4) return null;
				let km = 0;
				const points = pts.map((p, k) => {
					if (k) km += Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) / world.unitsPerKm;
					const [ lon, lat ] = world.unproject(p[0], p[1]);
					return { km, m: world.metresAt(lon, lat) };
				});
				// The DEM's cells are about 1.8 km wide, coarser than a canyon floor: where the drawn
				// line ends no lower than it starts, the grid cannot resolve this river, so no profile.
				if (points[points.length - 1].m >= points[0].m) return null;
				return { id, points, via, ending };
			},
			// For tests: lowest and highest height in the DEM grid, metres.
			demRange() {
				const z = world.elev.data;
				let lo = Infinity;
				let hi = -Infinity;
				for (let i = 0; i < z.length; i++) {
					if (z[i] < lo) lo = z[i];
					if (z[i] > hi) hi = z[i];
				}
				return [ lo, hi ];
			},
			// Zoom level as a multiple of the state view's distance: 1x shows the whole state.
			zoomFactor: () => home().dist / sc.camera.position.distanceTo(sc.controls.target),
			// A zoom preset: 1x flies home; closer levels ease in about the middle of the view with
			// the wheel's zoom (so tilt, ground clearance and the relief scale behave the same).
			zoomTo(k) {
				const d = sc.camera.position.distanceTo(sc.controls.target);
				if (k <= 1.001) {
					mover = flyTo(THREE, sc.camera, sc.controls, home(), motionMs(1200));
					return;
				}
				zoomBy(home().dist / k / d);
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
						return { target: [ b.cx, (b.P - 2) * scaleFor(dist), b.cz ], dist, az, polar };
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
				v3.set(b.cx, b.levelFor(0.6) * vScale, b.cz).project(sc.camera);
				return [ (v3.x + 1) / 2 * container.clientWidth, (1 - v3.y) / 2 * container.clientHeight ];
			},
			level: (id) => cur.levels[basins.basins.findIndex((b) => b.r.id === id)],
			// For tests: what each dam is visibly releasing right now.
			outflow: () => outflow.state().map((o, i) => ({ ...o, spill: cur.spill[i], pct: target.release[i].pct })),
			verifyWater: () => outflow.verify(),
			riverEndings: () => outflow.endings,
			ribbonEnds: () => outflow.ribbonEnds().map((e) => ({ ...e, ll: world.unproject(e.x, e.z).map((v) => +v.toFixed(3)) })),
			// For tests, at a month: outflow start to dam toe, inflow to the current water (vertical
			// gap above the water, 0 once it reaches it or the lake is empty) and gaps inside a line.
			riverTurns: (win) => outflow.turns(win),
			riverLinks: () => outflow.links().map((r) => ({ ...r, id: basins.basins[r.dam].r.id })),
			stemPoints: () => outflow.stemPoints(),
			damInfo: (id) => { const d = dams.info.get(id); return { toePoint: d.toePoint, center: d.center, toeU: d.toeU, faceBase: d.faceBase, spillBottom: d.spillBottom, chute: Boolean(d.chute), type: d.type }; },
			// For tests: put the camera at a pose (relief scale follows on the next frame).
			setPose(p) {
				mover = null;
				sc.controls.target.set(...p.target);
				sc.camera.position.copy(poseToPosition(THREE, p));
				sc.controls.update();
			},
			// For tests: where each dam's outflow ribbon is drawn to start, against the foot of the
			// dam's downstream face, as the current frame renders them (relief scale, and the lift a
			// big river gets when seen from far away): horizontal and vertical gap in world units,
			// and the gap on screen in CSS pixels.
			riverStartGaps() {
				const w = container.clientWidth;
				const h = container.clientHeight;
				const px = (p) => {
					v3.set(p[0], p[1], p[2]).project(sc.camera);
					return [ (v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h ];
				};
				return outflow.links().filter((r) => r.kind === 0).map((r) => {
					const b = basins.basins[r.dam];
					const f = dams.info.get(b.r.id).faceBase;
					// The first row of the ribbon as drawn (vertex buffer), with the shader's lift.
					const s0 = r.drawn;
					const camD = sc.camera.position.distanceTo(v3.set(s0[0], s0[1] * vScale, s0[2]));
					const t = Math.min(1, Math.max(0, (camD - 140) / 560));
					const far = t * t * (3 - 2 * t) * r.weight;
					const sy = (s0[1] + 0.03 + camD * 0.004 * far) * vScale;
					const fy = groundAt(f[0], f[2]);
					const a = px([ s0[0], sy, s0[2] ]);
					const c = px([ f[0], fy, f[2] ]);
					return { id: b.r.id, xz: Math.hypot(s0[0] - f[0], s0[2] - f[2]), dy: Math.abs(sy - fy), px: Math.hypot(a[0] - c[0], a[1] - c[1]) };
				});
			},
			pulseCount: () => pulses.count(),
			snowCover: () => snow.cover(),
			meltCount: () => melt.count(),
			meltRel: () => [ ...meltRel ],
			meltLines: () => meltLines.map((l) => ({ dam: basins.basins[l.dam].r.id, y0: l.pts[0][1], y1: l.pts[l.pts.length - 1][1] })),
			// For tests: the rain band's colour (core alpha at full strength) composited over the
			// valley floor's tan, and the contrast against the bare tan (WCAG luminance ratio).
			rainContrast: () => {
				const lum = (c) => {
					const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
					return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
				};
				const tan = new THREE.Color(0xa8926a); // terrain.js valleyDry
				const over = tan.clone().lerp(rainMat.uniforms.uColor.value, 0.55);
				const streak = over.clone().lerp(rainMat.uniforms.uStreak.value, 0.9);
				const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
				return { band: ratio(over, tan), streak: ratio(streak, over) };
			},
			eventFx: () => ({ name: fx ? fx.name : null, level: fxLevel, rain: rain.visible, spill: oroIdx >= 0 ? cur.spill[oroIdx] : null }),
			recordLow: () => {
				// Lake names the label overlaps without being dimmed (should be none).
				const t = record.lastChild.getBoundingClientRect();
				const clash = record.classList.contains("on") ? [ ...labels.layer.querySelectorAll(".lbl-text:not(.far)") ].filter((el) => !el.classList.contains("under-record") && el.closest(".lbl").style.display !== "none" && overlaps(el.getBoundingClientRect(), t)).map((el) => el.textContent) : [];
				return { id: record.dataset.id, on: record.classList.contains("on"), text: record.querySelector(".record-text").textContent, clash, dimmed: dimmed.length };
			},
			recordMonths: () => [ ...recordAt.entries() ].map(([ i, rs ]) => ({ i, ids: rs.map((r) => r.id), pct: rs[0].series[i] / rs[0].capacity })),
			outflowLine: (id) => outflow.riverPath(basins.basins.findIndex((b) => b.r.id === id)).pts,
			riverGaps: (i) => {
				const snap = snapshot(i);
				const rows = outflow.links();
				return basins.basins.map((b, di) => {
					const toe = dams.info.get(b.r.id).toePoint;
					const outs = rows.filter((r) => r.dam === di && r.kind === 0);
					const ins = rows.filter((r) => r.dam === di && r.kind === 1);
					const level = snap.levels[di];
					return {
						id: b.r.id,
						// Outflow start to the dam: its downstream toe, or the dam line itself (arch dams
						// bulge upstream, so their outflow starts just below the line).
						damGap: outs.length ? Math.min(...outs.map((r) => {
							const [ u, v ] = b.toLocal(r.start[0], r.start[2]);
							const toLine = Math.abs(v) <= b.dam.halfWidth ? Math.abs(u - b.dam.u) : Infinity;
							return Math.min(toLine, Math.hypot(r.start[0] - toe[0], r.start[2] - toe[2]));
						})) : null,
						// How far above the current water the inflow stops inside its lake; an inflow that
						// never enters the lake outline counts as a gap (99).
						waterGap: ins.length ? Math.min(99, Math.max(0, Math.min(...ins.map((r) => r.inLake - 0.12)) - Math.max(level, b.levelFor(0)))) : null,
						lineGap: Math.max(0, ...rows.filter((r) => r.dam === di).map((r) => r.gap)),
						hasOut: outs.length > 0,
						hasIn: ins.length > 0,
					};
				});
			},
			anisotropy: () => terrain.detail.anisotropy,
			mainRivers: () => mainRivers.names,
			waterways: () => ({ delta: mainRivers.delta, canals: mainRivers.canals, ends: mainRivers.ends }),
			project: (ll) => world.project(ll),
			unproject: (x, z) => world.unproject(x, z),
			surface: (x, z) => outflow.router.surface(x, z),
			centreOf: (id) => outflow.centreOf(basins.basins.findIndex((b) => b.r.id === id)),
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
			wildlife: () => wildlife.debug(),
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
			vScale: () => vScale,
			// For tests: lowest height of the camera and its near-plane corners over the ground or water.
			nearClear() {
				sc.camera.updateMatrixWorld();
				const p = sc.camera.position;
				let m = p.y - topAt(p.x, p.z);
				for (const [ x, y ] of [ [ -1, -1 ], [ 1, -1 ], [ -1, 1 ], [ 1, 1 ] ]) {
					v3.set(x, y, -1).unproject(sc.camera);
					m = Math.min(m, v3.y - topAt(v3.x, v3.z));
				}
				return m;
			},
			// For tests: the camera's height over the highest ground round it against its distance,
			// whether the sight line to the target clears the ground, and where the target lands on screen.
			viewCheck() {
				const p = sc.camera.position;
				const t = sc.controls.target;
				const d = p.distanceTo(t);
				const above = p.y - ringGround(p.x, p.z, Math.max(3, d * 0.35));
				let clear = true;
				for (let k = 1; k < 40; k++) {
					const f = k / 40;
					const x = t.x + (p.x - t.x) * f;
					const y = t.y + (p.y - t.y) * f;
					const z = t.z + (p.z - t.z) * f;
					if (groundAt(x, z) > y + 0.05) clear = false;
				}
				v3.copy(t).project(sc.camera);
				const r = canvas.getBoundingClientRect();
				return { dist: d, above, ratio: above / d, clear, screen: [ r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height ], canvas: [ r.left, r.top, r.right, r.bottom ] };
			},
			focusPose,
			damInView(id) {
				const info = dams.info.get(id);
				v3.set(info.center[0], info.crest * vScale, info.center[1]).project(sc.camera);
				return v3.z < 1 && Math.abs(v3.x) < 0.9 && Math.abs(v3.y) < 0.9;
			},
			// For tests: lowest height of each spillway chute floor above the ground under its full width.
			// For tests: where each spillway chute's water ends against the nearest outflow ribbon
			// centre point, at the current relief scale: horizontal gap, vertical gap, and the
			// biggest rise along the chute's run over the ground.
			chuteEnds: () => {
				const rivers = outflow.outflowLines().map((l) => l.pts);
				return basins.basins.filter((b) => dams.info.get(b.r.id).chute).map((b) => {
					const line = dams.info.get(b.r.id).chuteLine;
					const e = line[line.length - 1];
					let gap = Infinity;
					let dy = Infinity;
					for (const pts of rivers) for (const p of pts) {
						const d = Math.hypot(p[0] - e[0], p[2] - e[2]);
						if (d < gap) {
							gap = d;
							dy = Math.abs(p[1] - e[1]) * vScale;
						}
					}
					const chuteEnd = dams.info.get(b.r.id).chute.length;
					let rise = 0;
					for (let i = chuteEnd; i < line.length; i++) rise = Math.max(rise, line[i][1] - line[chuteEnd - 1][1]);
					return { id: b.r.id, gap, dy, vScale, rise: rise * vScale, run: line.length - chuteEnd, end: [ e[0], e[2] ], foot: [ line[chuteEnd - 1][0], line[chuteEnd - 1][2] ] };
				});
			},
			// For tests: points just downstream of each dam's upstream face, across the wall:
			// how many lie in the lake's carved bowl, and how many would show lake water (the
			// water shader's arch clip, mirrored here, and the lake level above the ground).
			lakeBelowDam: () => basins.basins.map((b, i) => {
				let bowl = 0;
				let wet = 0;
				let n = 0;
				const hw = b.dam.halfWidth;
				const span = b.Lu * 1.45 - b.u0;
				for (let t = 0.05; t < 1; t += 0.05) {
					const v = (t * 2 - 1) * hw;
					for (const back of [ 0.08, 0.3, 0.8 ]) {
						const u = b.damU(v) - back;
						const [ x, z ] = b.toWorld(u, v);
						const sfc = basins.surfaceAt(x, z);
						n++;
						// The lake's own carve (another lake just below, e.g. Courtright into Wishon, is fine).
						const own = b.heightAtLocal(u, v, sfc ? sfc.h : 0);
						if (own && own.zone === "bowl") bowl++;
						const ux = (u - b.u0) / span;
						const ta = (v / (2.9 * b.Lv)) / (hw / (2.9 * b.Lv));
						const clipped = ux < 0 || ux < b.dam.bulge * hw / span * Math.max(0, 1 - ta * ta);
						if (!clipped && sfc && cur.levels[i] > sfc.h) wet++;
					}
				}
				return { id: b.r.id, bulge: b.dam.bulge, n, bowl, wet };
			}),
			chuteClearance: () => [ ...dams.info.values() ].filter((d) => d.chute).map((d) => d.chuteClear),
			setLayer(name, on) {
				if (name === "labels") container.classList.toggle("labels-off", !on);
				else if (name === "front" || name === "path") fxLayer[name] = on;
				else (layerObjs[name] || []).forEach((o) => (o.visible = on));
			},
			layerOn: (name) => (name in fxLayer ? fxLayer[name] : name === "labels" ? !container.classList.contains("labels-off") : (layerObjs[name] || [])[0]?.visible ?? false),
			scaleText: () => scaleBar.lastChild.textContent,
			linksVisible: () => links.visibleCount(),
			setLinks: (v) => links.setShowAll(v),
			pose: () => poseOf(THREE, sc.camera, sc.controls),
			moving: () => Boolean(mover || replayFn || zoom.active),
			// For tests: ground point under a client position, and a world point's client position.
			groundUnder: (x, y) => groundUnder(x, y)?.toArray() ?? null,
			toClient(p) {
				v3.set(...p).project(sc.camera);
				const r = canvas.getBoundingClientRect();
				return [ r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height ];
			},
			northDeg: () => northDeg,
			// For tests: straight down from the dam's crest to where its river starts (and on), what
			// shows from above at each step: the dam, the river or bare ground. A river that leaves
			// from under the dam has no ground between the two.
			damToRiver(id) {
				const di = lakeIdx.get(id);
				const info = dams.info.get(id);
				const r0 = outflow.links().find((l) => l.dam === di && l.kind === 0);
				if (!r0 || !r0.drawn) return null;
				const b = basins.byId.get(id);
				const [ cu, cv ] = [ b.dam.u, b.toLocal(info.toePoint[0], info.toePoint[2])[1] ];
				const [ ax, az ] = b.toWorld(cu, cv);
				const s0 = r0.drawn;
				const ex = s0[0];
				const ez = s0[2];
				const ray = new THREE.Raycaster();
				const seq = [];
				for (let k = 0; k <= 40; k++) {
					const f = k / 32;
					const x = ax + (ex - ax) * f;
					const z = az + (ez - az) * f;
					ray.set(v3.set(x, 900, z), toCam.set(0, -1, 0));
					const h = ray.intersectObjects([ dams.mesh, outflow.group, terrain.group ], true).find((q) => q.object.isMesh && q.object.visible && q.object.material.visible !== false);
					let o = h?.object;
					let what = "none";
					while (o) {
						if (o === dams.mesh) { what = "dam"; break; }
						if (o === outflow.group) { what = "river"; break; }
						if (o === terrain.group) { what = "ground"; break; }
						o = o.parent;
					}
					seq.push(what[0]);
				}
				const str = seq.join("");
				// Bare ground between the dam and its river (in either order along the line); none
				// if the river runs on from under the dam. No dam seen at all counts as a gap.
				const runs = [ ...str.matchAll(/d(g+)r|r(g+)d/g) ].map((m) => (m[1] ?? m[2]).length);
				const gap = !str.includes("d") ? 99 : Math.max(0, ...runs);
				const lateral = Math.abs(b.toLocal(ex, ez)[1] - cv);
				// Horizontal distance, in world units, from where the dam last shows to the river head.
				const step = Math.hypot(ex - ax, ez - az) / 32;
				return { id, seq: str, gap, gapUnits: gap === 99 ? 99 : gap * step, lateral, halfWidth: info.halfWidth };
			},
			// For tests: how far downstream of where the dam last shows above the ground its river
			// starts (world units, 0 when the river leaves from under the dam). Walks from just
			// upstream of the crest's middle straight downstream, raycasting the dam and the ground, and keeps the
			// furthest point of the unbroken run where it stands above the ground.
			damRiverGap(id) {
				const di = lakeIdx.get(id);
				const info = dams.info.get(id);
				const r0 = outflow.links().find((l) => l.dam === di && l.kind === 0);
				if (!r0 || !r0.drawn) return null;
				const b = basins.byId.get(id);
				const [ cx, cz ] = info.center;
				const dx = -b.eu[0];
				const dz = -b.eu[1];
				const head = r0.drawn;
				const along = (head[0] - cx) * dx + (head[2] - cz) * dz;
				const lateral = Math.abs((head[0] - cx) * dz - (head[2] - cz) * dx);
				const ray = new THREE.Raycaster();
				const STEP = 0.03;
				let shows = null;
				for (let t = -1; t <= Math.max(along, 1) + 2; t += STEP) {
					const x = cx + dx * t;
					const z = cz + dz * t;
					ray.set(v3.set(x, 900, z), toCam.set(0, -1, 0));
					const h = ray.intersectObject(dams.mesh, false)[0];
					// The ground as drawn (the terrain mesh), else the height it is built from.
					const g = ray.intersectObject(terrain.group, true).find((q) => q.object.isMesh && q.object.visible)?.point.y ?? groundAt(x, z);
					if (!h || h.point.y < g + 0.02 * vScale) {
						if (shows !== null || t > 0.5) break;
						continue;
					}
					shows = t;
				}
				shows ??= 0;
				return { id, along: +along.toFixed(3), shows: +shows.toFixed(3), gap: +Math.max(0, along - shows).toFixed(3), lateral: +lateral.toFixed(3), halfWidth: info.halfWidth };
			},
			// For tests: the drought front, flares and path as drawn now; and the camera follow.
			droughtFront: () => drought.stats(),
			flares: () => drought.flares(),
			droughtPaths: () => drought.paths(),
			followNow() {
				followId = null;
				if (ui.follow) followTo(store.get().dateIndex);
			},
			followId: () => followId,
			keyboardPick: () => kbId,
			dispose() {
				this.stop();
				clearTimeout(recordTimer);
				record.remove();
				drought.dispose();
				pulses.dispose();
				melt.dispose();
				snow.dispose();
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

	const layerPrefs = {};
	const api = {
		async mount(progress = () => {}) {
			if (!ready) ready = init(progress).then((c) => (ctx = c));
			await ready;
			if (ctx) Object.entries(layerPrefs).forEach(([ k, v ]) => ctx.setLayer(k, v));
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
		// Zoom presets for the dock's zoom menu, as multiples of the state view.
		zoomLevels: [ { name: "State", k: 1 }, { name: "Region", k: 4 }, { name: "Basin", k: 12 }, { name: "Reservoir", k: 40 } ],
		zoomLevel: () => (ctx ? ctx.zoomFactor() : 1),
		riverProfile: (id) => (ctx ? ctx.riverProfile(id) : null),
		setZoom(k) {
			if (ui.replaying) stopReplay();
			if (ctx) ctx.zoomTo(k);
		},
		onZoom(fn) {
			zoomListener = fn;
			lastZoom = 0;
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
		// Layers panel. Choices made before the scene is built are applied once it is.
		setLayer(name, on) {
			layerPrefs[name] = on;
			if (ctx) ctx.setLayer(name, on);
		},
		setLabelOpacity(v) {
			container.style.setProperty("--label-opacity", String(v));
		},
		debug: () => ctx,
		onProgress: () => {},
		available: webglAvailable(),
		ui,
		hint: "Drag to orbit, scroll or pinch to zoom, right-drag or two fingers to pan. Click a lake to fly in.",
	};
	return api;
}
