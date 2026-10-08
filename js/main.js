// Entry point: loads data, wires the store to the 2D/3D views, timeline, legend and summary.
import { loadData } from "./data.js";
import { createStore } from "./state.js";
import { createTooltip } from "./tooltip.js";
import { createTimeline } from "./timeline.js";
import { createSummary } from "./summary.js";
import { renderLegend } from "./legend.js";
import { initTheme } from "./theme.js";
import { createMap2D } from "./map2d.js";
import { createView3D } from "./view3d.js";
import { createDetailCard } from "./detailCard.js";
import { createAudio } from "./audio/engine.js";
import { initSoundControls } from "./audio/controls.js";

// On a phone the legend folds away behind "Legend", so the map is near the top of the screen;
// wider screens keep it open (its summary line is hidden there by CSS).
{
	const lw = document.getElementById("legendWrap");
	if (lw && window.matchMedia && window.matchMedia("(max-width: 700px)").matches) { lw.open = false; }
}
import { flowScale } from "./scales.js";
import { createRelease } from "./release.js";

const $ = (sel) => document.querySelector(sel);
const d3 = window.d3;

const MODE_KEY = "cdi-mode";

// 3D by default; an explicit ?mode= wins, then the visitor's last choice. No WebGL -> 2D.
function initialMode(params) {
	const canvas = document.createElement("canvas");
	let gl = false;
	try {
		gl = Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
	} catch (e) { /* no WebGL */ }
	if (!gl) return "2d";
	const asked = params.get("mode");
	if (asked === "2d" || asked === "3d") return asked;
	try {
		const saved = localStorage.getItem(MODE_KEY);
		if (saved === "2d" || saved === "3d") return saved;
	} catch (e) { /* storage unavailable */ }
	return "3d";
}

function setProgress(f, text) {
	const el = document.querySelector("#loading");
	el.querySelector(".loading-bar span").style.width = `${Math.round(f * 100)}%`;
	if (text) el.querySelector(".loading-text").textContent = text;
}

// Every count and date range in the page copy comes from the data.
function fillCounts(data) {
	const long = d3.timeFormat("%B %Y");
	const year = d3.timeFormat("%Y");
	const names = (list) => list.map((r) => r.name.replace(/ (Dam|Reservoir)$/, "")).join(" and ");
	const values = {
		mapped: data.reservoirs.length,
		reporting: data.reservoirs.filter((r) => r.hasData).length,
		tracked: data.tracked.length,
		"flood-names": names(data.floodControl),
		"no-data-names": names(data.noData),
		first: long(data.dates[0]),
		last: long(data.dates[data.dates.length - 1]),
		"first-year": year(data.dates[0]),
		"last-year": year(data.dates[data.dates.length - 1]),
		gauges: data.gauges.length,
		"gauges-flow": data.gauges.filter((g) => g.flow).length,
	};
	document.querySelectorAll("[data-count]").forEach((el) => {
		const v = values[el.dataset.count];
		if (v !== undefined) el.textContent = String(v);
	});
	const desc = document.querySelector("meta[name=description]");
	if (desc) desc.content = `Interactive 2D and 3D visualization of storage in ${values.reporting} California reservoirs, ${values["first-year"]} to ${values["last-year"]}.`;
}

async function start() {
	const stage = $("#stage");
	const loading = $("#loading");
	let data;
	try {
		data = await loadData();
	} catch (err) {
		loading.querySelector(".loading-text").textContent = "Could not load the data files. Serve this folder over HTTP (see README).";
		throw err;
	}

	const params = new URLSearchParams(location.search);
	const startMonth = params.get("month") ?? "2014-09"; // the 2016 prototype's storage snapshot
	setProgress(0.04, "Loading data…");
	const startIndex = Math.max(0, data.months.indexOf(startMonth));
	const store = createStore({
		dateIndex: startIndex >= 0 ? startIndex : data.months.length - 1,
		playing: false,
		mode: initialMode(params),
		selected: null,
	});

	const tooltip = createTooltip($("#tooltip"), stage, data);
	fillCounts(data);
	const audio = createAudio();
	const views = {
		"2d": createMap2D($("#view-2d"), data, store, tooltip, audio),
		"3d": createView3D($("#view-3d"), data, store, tooltip, audio),
	};
	const release = createRelease(data);
	const soundUi = { turnOn: async () => {} };
	createDetailCard(stage, data, store, { audio, release, turnOn: () => soundUi.turnOn() });

	// Statewide sound mood for a month: storage drives water vs. wind, flow adds body.
	const gaugesWithFlow = data.gauges.filter((g) => g.flow);
	const mood = (i) => {
		const wet = Math.min(1, Math.max(0, (data.totals[i].pct - 0.3) / 0.45));
		const flow = gaugesWithFlow.reduce((acc, g) => acc + flowScale(g.flow[i] ?? 0), 0) / Math.max(1, gaugesWithFlow.length);
		audio.setMonth(wet, flow);
	};
	const sound = initSoundControls($("#sound"), audio, () => {
		mood(store.get().dateIndex);
		audio.setDamLevels(release.voicesAt(store.get().dateIndex));
	});
	soundUi.turnOn = sound.turnOn;
	audio.setDamLevels(release.voicesAt(store.get().dateIndex));
	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex")) {
			// An open tooltip follows the timeline instead of showing the old month.
			tooltip.refresh(s.dateIndex);
			audio.tick();
			mood(s.dateIndex);
			audio.setDamLevels(release.voicesAt(s.dateIndex));
		}
		if (changed.includes("selected")) {
			if (s.selected) audio.select();
			audio.setFocus(s.selected);
			if (audio.solo && audio.solo !== s.selected) audio.setSolo(null);
		}
	});

	createTimeline($("#timeline"), data, store);
	createSummary($("#summary"), data, store, (r) => {
		const again = store.get().selected === r.id;
		store.set({ selected: r.id });
		if (again) views[store.get().mode].focusReservoir(r);
	});

	const modeButtons = document.querySelectorAll(".mode-switch button");
	modeButtons.forEach((b) => b.addEventListener("click", () => {
		store.set({ mode: b.dataset.mode });
		try {
			localStorage.setItem(MODE_KEY, b.dataset.mode);
		} catch (e) { /* storage unavailable */ }
	}));
	if (!views["3d"].available) {
		const b3 = document.querySelector(".mode-switch button[data-mode=\"3d\"]");
		b3.disabled = true;
		b3.title = "3D needs WebGL, which is turned off in this browser";
	}
	views["3d"].onProgress = setProgress;

	async function showMode(mode) {
		tooltip.hide();
		modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
		renderLegend($("#legend"), mode);
		$("#stage-hint").textContent = views[mode].hint;
		$("#view-2d").hidden = mode !== "2d";
		$("#view-3d").hidden = mode !== "3d";
		views[mode === "2d" ? "3d" : "2d"].pause();
		const url = new URL(location.href);
		if (url.searchParams.has("mode")) {
			url.searchParams.set("mode", mode);
			history.replaceState(null, "", url);
		}
		const first3d = mode === "3d" && !views["3d"].debug();
		if (first3d) {
			loading.classList.remove("done");
			setProgress(0.05, "Loading 3D terrain…");
		}
		try {
			await views[mode].mount(setProgress);
			if (first3d) setProgress(1, "Ready");
		} finally {
			loading.classList.add("done");
		}
		document.body.dataset.mode = mode;
	}

	store.subscribe((s, changed) => {
		if (changed.includes("mode")) showMode(s.mode);
	});

	$("#reset-view").addEventListener("click", () => views[store.get().mode].resetView());

	initTheme($("#theme-toggle"), (theme) => views["3d"].setTheme(theme));

	await showMode(store.get().mode);
	document.body.dataset.ready = "true";

	// Small hook for the automated checks in tests/check.mjs.
	window.droughtViz = { store, data, views, audio };
}

start();
