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

const $ = (sel) => document.querySelector(sel);

async function start() {
	const stage = $("#stage");
	const loading = $("#loading");
	let data;
	try {
		data = await loadData();
	} catch (err) {
		loading.textContent = "Could not load the data files. Serve this folder over HTTP (see README).";
		throw err;
	}

	const params = new URLSearchParams(location.search);
	const startMonth = params.get("month") ?? "2014-09"; // the 2016 prototype's storage snapshot
	const startIndex = Math.max(0, data.months.indexOf(startMonth));
	const store = createStore({
		dateIndex: startIndex >= 0 ? startIndex : data.months.length - 1,
		playing: false,
		mode: params.get("mode") === "3d" ? "3d" : "2d",
		selected: null,
	});

	const tooltip = createTooltip($("#tooltip"), stage);
	const views = {
		"2d": createMap2D($("#view-2d"), data, store, tooltip),
		"3d": createView3D($("#view-3d"), data, store, tooltip),
	};

	createTimeline($("#timeline"), data, store);
	createSummary($("#summary"), data, store, (r) => {
		store.set({ selected: r.id });
		views[store.get().mode].focusReservoir(r);
	});

	const modeButtons = document.querySelectorAll(".mode-switch button");
	modeButtons.forEach((b) => b.addEventListener("click", () => store.set({ mode: b.dataset.mode })));

	async function showMode(mode) {
		tooltip.hide();
		modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
		renderLegend($("#legend"), mode);
		$("#stage-hint").textContent = views[mode].hint;
		$("#view-2d").hidden = mode !== "2d";
		$("#view-3d").hidden = mode !== "3d";
		views[mode === "2d" ? "3d" : "2d"].pause();
		const url = new URL(location.href);
		if (mode === "3d") url.searchParams.set("mode", "3d");
		else url.searchParams.delete("mode");
		history.replaceState(null, "", url);
		if (mode === "3d") {
			loading.hidden = false;
			loading.textContent = "Loading 3D…";
		}
		try {
			await views[mode].mount();
		} finally {
			loading.hidden = true;
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
	window.droughtViz = { store, data, views };
}

start();
