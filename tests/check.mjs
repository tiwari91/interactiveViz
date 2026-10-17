// End-to-end checks for the drought visualization, run in headless Chromium.
//   CHROME_BIN=/path/to/chrome-headless-shell node tests/check.mjs
//   PLAYWRIGHT_FROM (or PW_REQUIRE)=/path/to/package.json picks the playwright install.
//   CHROME_ARGS="--use-gl=angle --use-angle=metal" replaces the default SwiftShader GL flags.
// Serves the repo on a free port, runs the checks, saves screenshots to tests/screenshots/.
// Every expected count comes from the data files, never a hard-coded number.
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? process.env.PW_REQUIRE ?? "/Users/shankartiwar/Cayuse/s2s-web-client/package.json");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "tests", "screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml", ".png": "image/png", ".bin": "application/octet-stream" };

function serve() {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://x");
		let file = path.join(ROOT, decodeURIComponent(url.pathname));
		if (!file.startsWith(ROOT)) return res.writeHead(403).end();
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
		if (!fs.existsSync(file)) return res.writeHead(404).end("not found");
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const results = [];
const preloadWarnings = [];
function check(name, ok, detail = "") {
	results.push({ name, ok: Boolean(ok), detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function openPage(browser, base, { phone = false, scheme = "light", query = "", noWebGL = false, reducedMotion = "no-preference" } = {}) {
	const ctx = await browser.newContext({ ...(phone ? devices["iPhone 12"] : { viewport: { width: 1440, height: 1000 } }), colorScheme: scheme, reducedMotion });
	const page = await ctx.newPage();
	if (noWebGL) {
		await page.addInitScript(() => {
			const orig = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
				return /webgl/.test(type) ? null : orig.call(this, type, ...rest);
			};
		});
	}
	const errors = [];
	page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} @ ${query || "/"} ${m.location().url?.replace(base, "")}:${m.location().lineNumber}`));
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => m.type() === "warning" && /preload/i.test(m.text()) && preloadWarnings.push(`${m.text().slice(0, 160)} @ ${query || "/"}`));
	await page.goto(`${base}/${query}`);
	await page.waitForFunction(() => document.body.dataset.ready === "true", null, { timeout: 120000, polling: 500 });
	return { ctx, page, errors };
}

const stateOf = (page) => page.evaluate(() => window.droughtViz.store.get());
const setState = (page, patch) => page.evaluate((p) => window.droughtViz.store.set(p), patch);
const monthIndex = async (page, m) => {
	const i = await page.evaluate((x) => window.droughtViz.data.months.indexOf(x), m);
	if (i < 0) throw new Error(`month ${m} is not in the data`);
	return i;
};
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const facts = (page) => page.evaluate(() => {
	const d = window.droughtViz.data;
	return {
		months: d.months,
		reservoirs: d.reservoirs.length,
		reporting: d.reservoirs.filter((r) => r.hasData).length,
		tracked: d.tracked.map((r) => r.id),
		flood: d.floodControl.map((r) => r.id),
		links: d.links.length,
	};
});
const debug3d = (page, expr) => page.evaluate(`(() => { const c = window.droughtViz.views["3d"].debug(); return ${expr}; })()`);

// Element screenshot via a page clip (the WebGL canvas never "settles" for locator screenshots).
async function shot(page, name, selector = null) {
	const opts = { path: path.join(SHOTS, name), timeout: 120000 };
	if (selector) {
		opts.fullPage = true;
		opts.clip = await page.evaluate((s) => {
			const r = document.querySelector(s).getBoundingClientRect();
			return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
		}, selector);
	} else opts.fullPage = true;
	await page.screenshot(opts);
}

async function waitStill(page, ms = 2500) {
	await page.waitForFunction(() => !window.droughtViz.views["3d"].debug()?.moving(), null, { timeout: 30000 }).catch(() => {});
	await page.waitForTimeout(ms);
}

// Zoom input and exactness, from close, oblique views over steep canyon lakes: every input
// (wheel, ctrl+wheel pinch, Safari gesture events, two-finger touch) zooms the right way; the
// ground point under the pointer stays under it every frame; tilt moves one way per leg without
// jumps; near the ground zoom never bounces back and never puts the camera under ground or water.
async function zoomChecks(page) {
	await page.evaluate(() => window.scrollTo(0, 0));
	const box = await page.locator("#view-3d canvas").boundingBox();
	// Whole pixels: mouse events report integer clientX/Y, so a fractional pointer would put the
	// app's anchor up to half a pixel away from the test's, and zooming magnifies that gap.
	const at = (fx, fy) => [ Math.round(box.x + box.width * fx), Math.round(box.y + box.height * fy) ];
	const fly = async (id) => {
		await debug3d(page, `c.focus("${id}")`);
		await waitStill(page, 400);
	};
	const dist = async () => (await debug3d(page, "c.pose()")).dist;
	const record = (a) => page.evaluate((a) => {
		const c = window.droughtViz.views["3d"].debug();
		const k0 = c.vScale();
		window.__zr = [];
		const f = () => {
			const k = c.vScale();
			const p = c.pose();
			window.__zr.push({ d: p.dist, polar: p.polar, s: a ? c.toClient([ a[0], a[1] / k0 * k, a[2] ]) : null, k, clear: c.nearClear() });
			window.__zrr = requestAnimationFrame(f);
		};
		window.__zrr = requestAnimationFrame(f);
	}, a);
	const stop = () => page.evaluate(() => { cancelAnimationFrame(window.__zrr); return window.__zr; });
	const wheel = async (x, y, n, dy, gap = 16) => {
		await page.mouse.move(x, y);
		for (let k = 0; k < n; k++) {
			await page.mouse.wheel(0, dy);
			await page.waitForTimeout(gap);
		}
	};

	// Every input zooms, both ways, from a close view in a canyon.
	const inputs = {};
	const [ cx, cy ] = at(0.45, 0.6);
	const tryInput = async (name, fn) => {
		await fly("PNF");
		const d0 = await dist();
		await fn(-1);
		await waitStill(page, 200);
		const d1 = await dist();
		await fn(1);
		await waitStill(page, 200);
		const d2 = await dist();
		inputs[name] = { ok: d1 < d0 * 0.8 && d2 > d1 * 1.25, txt: `${d0.toFixed(0)}->${d1.toFixed(0)}->${d2.toFixed(0)}` };
	};
	await tryInput("wheel", (dir) => wheel(cx, cy, 6, dir * 100));
	await tryInput("ctrl+wheel", async (dir) => {
		await page.keyboard.down("Control");
		await wheel(cx, cy, 6, dir * 30);
		await page.keyboard.up("Control");
	});
	await tryInput("gesture", (dir) => page.evaluate(([ x, y, dir ]) => {
		const cv = document.querySelector("#view-3d canvas");
		const send = (type, scale) => {
			const e = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(e, { scale, clientX: x, clientY: y });
			cv.dispatchEvent(e);
			return e.defaultPrevented;
		};
		let prevented = send("gesturestart", 1);
		return new Promise((done) => {
			let i = 0;
			const t = setInterval(() => {
				i++;
				prevented = send("gesturechange", Math.pow(dir < 0 ? 1.08 : 1 / 1.08, i)) && prevented;
				if (i === 8) {
					clearInterval(t);
					send("gestureend", Math.pow(dir < 0 ? 1.08 : 1 / 1.08, i));
					done(prevented);
				}
			}, 16);
		});
	}, [ cx, cy, dir ]));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
	await tryInput("touch pinch", async (dir) => {
		const pts = (s) => [ { x: cx - s, y: cy, id: 1 }, { x: cx + s, y: cy, id: 2 } ];
		const s0 = dir < 0 ? 40 : 120;
		const s1 = dir < 0 ? 120 : 40;
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(s0) });
		for (let i = 1; i <= 10; i++) {
			await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(s0 + (s1 - s0) * i / 10) });
			await page.waitForTimeout(16);
		}
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	});
	await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
	await cdp.detach();
	check("Every zoom input works both ways from a close canyon view (wheel, ctrl+wheel pinch, Safari gesture, touch pinch)", Object.values(inputs).every((v) => v.ok), Object.entries(inputs).map(([ k, v ]) => `${k} ${v.txt}${v.ok ? "" : " FAIL"}`).join("; "));

	// (a) The ground point under an off-centre pointer stays under it, every frame and at rest.
	const drifts = [];
	for (const [ id, n, dy, fx, fy ] of [ [ "PNF", 8, -100, 0.3, 0.62 ], [ "ORO", 16, -200, 0.68, 0.58 ] ]) {
		await fly(id);
		const [ x, y ] = at(fx, fy);
		const a = await debug3d(page, `c.groundUnder(${x}, ${y})`);
		if (!a) {
			drifts.push({ id, miss: true });
			continue;
		}
		await record(a);
		await wheel(x, y, n, dy);
		await waitStill(page, 300);
		const log = await stop();
		let max = 0;
		for (const f of log) max = Math.max(max, Math.hypot(f.s[0] - x, f.s[1] - y));
		const last = log[log.length - 1];
		const ks = log.map((f) => f.k);
		drifts.push({ id, max, rest: Math.hypot(last.s[0] - x, last.s[1] - y), relief: Math.max(...ks) / Math.min(...ks), d: [ log[0].d, last.d ] });
	}
	check("Zoom holds the ground point under the pointer every frame, also while the relief flattens", drifts.every((r) => !r.miss && r.max <= 2 && r.rest <= 2) && drifts.some((r) => r.relief > 1.1),
		drifts.map((r) => r.miss ? `${r.id} no ground` : `${r.id} ${r.d[0].toFixed(0)}->${r.d[1].toFixed(0)} max ${r.max.toFixed(1)} px, at rest ${r.rest.toFixed(1)} px, relief x${r.relief.toFixed(2)}`).join("; "));

	// (b) Tilt changes smoothly and one way per leg through a full zoom in and back out, also on a
	// slow machine: with 60 ms frames each zoom step is several times larger, which must not
	// turn into larger tilt jumps.
	const tiltRun = async (slow) => {
		await fly("PNF");
		await record(null);
		if (slow) await page.evaluate(() => { const f = () => { const t = performance.now(); while (performance.now() - t < 60); window.__busy = requestAnimationFrame(f); }; window.__busy = requestAnimationFrame(f); });
		const [ tx, ty ] = at(0.55, 0.55);
		await wheel(tx, ty, 12, -200);
		await waitStill(page, 200);
		const inLen = (await page.evaluate(() => window.__zr.length));
		await wheel(tx, ty, 12, 200);
		await waitStill(page, 200);
		if (slow) await page.evaluate(() => cancelAnimationFrame(window.__busy));
		const tl = await stop();
		// Over high ground zooming in may look down more (to stay clear) or tilt toward the horizon,
		// but each leg turns at most once: no back-and-forth swinging.
		let jump = 0;
		let jumpAt = "";
		const turns = [ 0, 0 ];
		const sign = [ 0, 0 ];
		for (let i = 1; i < tl.length; i++) {
			const dp = tl[i].polar - tl[i - 1].polar;
			if (Math.abs(dp) > jump) jumpAt = `${i < inLen ? "in" : "out"} frame ${i < inLen ? i : i - inLen} of ${i < inLen ? inLen : tl.length - inLen}`;
			jump = Math.max(jump, Math.abs(dp));
			const leg = i < inLen ? 0 : 1;
			if (Math.abs(dp) < 1e-3) continue;
			if (sign[leg] && Math.sign(dp) !== sign[leg]) turns[leg]++;
			sign[leg] = Math.sign(dp);
		}
		return { ok: jump <= 0.02 && Math.max(...turns) <= 1, txt: `${slow ? "60 ms frames" : "full rate"}: largest tilt step ${jump.toFixed(4)} rad/frame (${jumpAt}), reversals in ${turns[0]} out ${turns[1]}; polar ${tl[0].polar.toFixed(2)} -> ${tl[inLen - 1].polar.toFixed(2)} -> ${tl[tl.length - 1].polar.toFixed(2)}` };
	};
	const tilts = [ await tiltRun(false), await tiltRun(true) ];
	check("Zoom tilt is smooth and never swings back and forth (in, then out), also at a low frame rate", tilts.every((r) => r.ok), tilts.map((r) => r.txt).join("; "));

	// (c) Near the ground: zooming hard in over a canyon (and over water) only ever closes in,
	// keeps the camera and its near plane above ground and water, and comes to rest.
	const near = [];
	for (const [ id, fx, fy ] of [ [ "PNF", 0.6, 0.55 ], [ "ORO", 0.5, 0.5 ] ]) {
		await fly(id);
		await record(null);
		const [ x, y ] = at(fx, fy);
		await wheel(x, y, 25, -400, 40);
		const t0 = Date.now();
		await page.waitForFunction(() => !window.droughtViz.views["3d"].debug().moving(), null, { timeout: 5000, polling: 50 }).catch(() => {});
		const rest = (Date.now() - t0) / 1000;
		await page.waitForTimeout(500);
		const log = await stop();
		let lo = Infinity;
		let bounce = 0;
		for (const f of log) {
			lo = Math.min(lo, f.d);
			bounce = Math.max(bounce, f.d / lo - 1);
		}
		const tail = log.slice(-20).map((f) => f.d);
		near.push({ id, bounce, clear: Math.min(...log.map((f) => f.clear)), rest, still: Math.max(...tail) - Math.min(...tail), d: [ log[0].d, log[log.length - 1].d ] });
	}
	check("Zooming in to the ground never bounces, never goes under ground or water, and comes to rest", near.every((r) => r.bounce <= 0.005 && r.clear > 0 && r.rest < 3 && r.still < 1e-3),
		near.map((r) => `${r.id} ${r.d[0].toFixed(0)}->${r.d[1].toFixed(1)} bounce ${(100 * r.bounce).toFixed(1)}%, min clearance ${r.clear.toFixed(2)}, rest in ${r.rest.toFixed(1)} s`).join("; "));
	await debug3d(page, "c.home()");
	await waitStill(page, 500);
}

async function main() {
	fs.mkdirSync(SHOTS, { recursive: true });
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await chromium.launch({
		executablePath: process.env.CHROME_BIN || undefined,
		args: [ ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(/\s+/) : [ "--use-angle=swiftshader", "--enable-unsafe-swiftshader" ]), "--ignore-gpu-blocklist", "--autoplay-policy=user-gesture-required" ],
	});
	const allErrors = [];

	try {
		// ---------- Default mode and WebGL fallback ----------
		let { ctx, page, errors } = await openPage(browser, base);
		if (process.env.ONLY === "zoom") {
			await zoomChecks(page);
			check("Zero console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
			return;
		}
		const elevMeta = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "elevation.json"), "utf8")).grids;
		check("Elevation grids ship in the compact encoding", Object.values(elevMeta).every((g) => g.encoding === "grad-planes-v1" && fs.statSync(path.join(ROOT, "data", g.file)).size === g.rows * g.cols * 2), Object.values(elevMeta).map((g) => `${g.file} ${g.encoding}`).join(", "));
		const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".js") ? [ `${d}/${e.name}` ] : []));
		const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
		const preloaded = new Set([ ...html.matchAll(/rel="modulepreload" href="([^"]+)"/g) ].map((m) => m[1]));
		const mods = walk("js");
		check("Every module is preloaded from the page head (no import waterfall), and nothing stale", mods.every((m) => preloaded.has(m)) && preloaded.size === mods.length, `${preloaded.size} preloads, ${mods.length} modules; missing ${mods.filter((m) => !preloaded.has(m)).join(", ") || "none"}`);
		check("Default view is 3D", (await stateOf(page)).mode === "3d" && (await page.locator("#view-3d canvas").count()) === 1);
		check("Loading overlay clears after 3D builds", await page.locator("#loading.done").count() === 1);
		// ---------- Workspace: layers, step, key events, charts, scale bar ----------
		{
			const on = (n) => page.evaluate((k) => window.droughtViz.views["3d"].debug().layerOn(k), n);
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"rivers\"]");
			check("Layers: unchecking Rivers hides the 3D river objects", (await on("rivers")) === false);
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"rivers\"]");
			check("Layers: checking Rivers shows them again", (await on("rivers")) === true);
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"forest\"]");
			check("Layers: unchecking trees hides the riparian forest", (await on("forest")) === false);
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"forest\"]");
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"labels\"]");
			check("Layers: unchecking Labels hides the 3D labels", await page.evaluate(() => getComputedStyle(document.querySelector(".labels-3d")).display === "none"));
			await page.evaluate((q) => document.querySelector(q).click(), "[data-layer-toggle=\"labels\"]");
			await page.evaluate((v) => { const i = document.querySelector(".layer-opacity"); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, "40");
			const lo = await page.evaluate(() => +getComputedStyle(document.querySelector(".labels-3d")).opacity);
			check("Labels opacity slider sets the label layer opacity", Math.abs(lo - 0.4) < 0.01, String(lo));
			await page.evaluate((v) => { const i = document.querySelector(".layer-opacity"); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, "100");
			check("Scale bar shows a distance in km", /\d km$/.test(await page.locator(".scale-bar .scale-text").innerText()));
			await setState(page, { dateIndex: 40, playing: false });
			await page.evaluate((q) => document.querySelector(q).click(), ".step-btn[data-step=\"1\"]");
			check("Step button advances one month", (await stateOf(page)).dateIndex === 41);
			await page.evaluate((q) => document.querySelector(q).click(), ".step-btn[data-step=\"-1\"]");
			check("Step back button goes back one month", (await stateOf(page)).dateIndex === 40);
			const ev = await page.evaluate(() => [ ...document.querySelectorAll(".event-btn") ].map((b) => ({ i: +b.dataset.index, m: window.droughtViz.data.months[+b.dataset.index] })));
			check("Key events sit at the right months", ev.length === 4 && ev[0].m >= "2014-01" && ev[0].m <= "2015-12" && ev[1].m === "2017-02" && ev[2].m >= "2021-01" && ev[2].m <= "2022-12" && ev[3].m === "2023-01", JSON.stringify(ev));
			check("Timeline draws a marker per key event", (await page.locator(".track .event-mark").count()) === ev.length);
			await page.evaluate((q) => document.querySelector(q).click(), ".event-btn[data-event=\"oroville\"]");
			check("A key event jumps the timeline to its month", (await stateOf(page)).dateIndex === ev[1].i);
			const pts = await page.evaluate(() => [ ...document.querySelectorAll(".chart-svg") ].map((el) => +el.dataset.points));
			const want = await page.evaluate(() => { const d = window.droughtViz.data; const big = d.tracked.reduce((a, r) => (r.capacity > a.capacity ? r : a)); return [ d.dates.length, d.totals.filter((t) => t.ofAvg !== null).length, big.series.filter((v) => v !== null).length ]; });
			check("Charts plot one point per month of data", JSON.stringify(pts) === JSON.stringify(want), `${pts} vs ${want}`);
			await setState(page, { dateIndex: 0, playing: true });
			await page.waitForTimeout(900);
			const pl = await stateOf(page);
			await setState(page, { playing: false });
			check("Timeline player advances the month", pl.dateIndex > 0, String(pl.dateIndex));
			check("Selected reservoir card is empty until a pick", /Click a lake/.test(await page.locator("#res-card").innerText()));
			await setState(page, { selected: "SHA" });
			await page.waitForTimeout(200);
			const card = await page.locator("#res-card").innerText();
			check("Selected reservoir card shows the pick's capacity and storage", /Capacity/.test(card) && /AF/.test(card) && /SHA/.test(card), card.slice(0, 80));
			await setState(page, { selected: null });
			await page.evaluate(() => window.droughtViz.store.set({ dateIndex: window.droughtViz.data.months.indexOf("2014-09") }));
			await page.locator("#reset-view").click();
			await page.waitForTimeout(1800);
		}
		// ---------- Zoom menu in the map dock ----------
		{
			const zv = async () => parseFloat(await page.locator(".zoom-val").innerText());
			const homeD = await debug3d(page, "c.pose().dist");
			const z0 = await zv();
			await page.locator(".zoom-btn").click();
			const opts = await page.locator(".zoom-list [role=menuitem]").allInnerTexts();
			await page.locator(".zoom-list [role=menuitem][data-k=\"12\"]").click();
			await waitStill(page, 300);
			const basin = { val: await zv(), dist: await debug3d(page, "c.pose().dist"), clear: await debug3d(page, "c.nearClear()"), menu: await page.locator(".zoom-list").isHidden(), cur: await page.locator(".zoom-list [aria-current=true]").getAttribute("data-k") };
			await page.locator(".zoom-btn").click();
			await page.locator(".zoom-list [role=menuitem][data-k=\"1\"]").click();
			await waitStill(page, 300);
			const back = await zv();
			check("Zoom menu flies the 3D camera to a preset and shows the current zoom", Math.abs(z0 - 1) < 0.05 && opts.length === 4 && Math.abs(basin.val / 12 - 1) < 0.1 && Math.abs(homeD / basin.dist / 12 - 1) < 0.1 && basin.clear > 0 && basin.menu && basin.cur === "12" && Math.abs(back - 1) < 0.05,
				`start ${z0}x; options ${opts.map((o) => o.replace(/\s+/g, " ")).join(" | ")}; Basin -> ${basin.val}x (distance ${basin.dist.toFixed(0)} of ${homeD.toFixed(0)}), State -> ${back}x`);
			// The readout follows the wheel too.
			const box = await page.locator("#view-3d canvas").boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			for (let k = 0; k < 4; k++) {
				await page.mouse.wheel(0, -200);
				await page.waitForTimeout(30);
			}
			await waitStill(page, 300);
			const wz = await zv();
			const wd = await debug3d(page, "c.pose().dist");
			check("Zoom readout follows wheel zoom", wz > 1.5 && Math.abs(homeD / wd / wz - 1) < 0.05, `${wz}x at distance ${wd.toFixed(0)}`);
			await page.locator("#reset-view").click();
			await waitStill(page, 300);
		}
		await page.waitForTimeout(700);
		const staleStatus = /Loading data/.test(await page.locator("body").ariaSnapshot());
		check("Screen readers no longer find the loading status once the view is ready", !staleStatus);
		await page.waitForTimeout(2500);
		const named = await page.evaluate(() => [ ...document.querySelectorAll(".labels-3d .lbl") ].filter((e) => e.style.display !== "none" && !e.querySelector(".lbl-text").classList.contains("far")).length);
		check("Overview names at least 6 reservoirs", named >= 6, `${named} named`);
		await page.locator(".mode-switch button[data-mode=\"2d\"]").click();
		await page.reload();
		await page.waitForFunction(() => document.body.dataset.ready === "true", null, { timeout: 120000, polling: 500 });
		check("A saved 2D choice is honoured", (await stateOf(page)).mode === "2d");
		await ctx.close();
		allErrors.push(...errors);
		({ ctx, page, errors } = await openPage(browser, base, { noWebGL: true }));
		check("Without WebGL the page falls back to 2D", (await stateOf(page)).mode === "2d" && (await page.locator(".mode-switch button[data-mode=\"3d\"]").isDisabled()));
		await ctx.close();

		// ---------- Desktop 2D ----------
		({ ctx, page, errors } = await openPage(browser, base, { query: "?mode=2d" }));
		check("?mode=2d opens the 2D map", (await stateOf(page)).mode === "2d");
		{
			await page.locator(".zoom-btn").click();
			const opts2d = await page.locator(".zoom-list [role=menuitem]").count();
			await page.locator(".zoom-list [role=menuitem][data-k=\"4\"]").click();
			await page.waitForTimeout(800);
			const k2 = await page.evaluate(() => window.droughtViz.views["2d"].zoomLevel());
			const t2 = await page.locator(".zoom-val").innerText();
			await page.locator("#reset-view").click();
			await page.waitForTimeout(800);
			check("Zoom menu zooms the 2D map too", opts2d === 4 && Math.abs(k2 - 4) < 0.01 && t2 === "4.0×" && (await page.locator(".zoom-val").innerText()) === "1.0×", `${t2}, k ${k2}`);
		}
		const F = await facts(page);
		const counts = await page.evaluate(() => ({
			counties: document.querySelectorAll(".map-2d .county").length,
			reservoirs: document.querySelectorAll(".map-2d .res").length,
			streams: document.querySelectorAll(".map-2d .stream-flow").length,
			filled: [ ...document.querySelectorAll(".map-2d .res-fill") ].filter((c) => +c.getAttribute("r") > 0).length,
		}));
		check("2D map renders 58 counties", counts.counties === 58, `${counts.counties}`);
		check("2D renders all reservoirs", counts.reservoirs === F.reservoirs, `${counts.reservoirs} of ${F.reservoirs}`);
		const names2d = await page.evaluate(() => [ ...document.querySelectorAll(".map-2d .label") ].filter((t) => t.getAttribute("display") !== "none").map((t) => t.textContent));
		const kb = await page.evaluate(() => [ ...document.querySelectorAll(".map-2d .res") ].filter((e) => e.getAttribute("tabindex") === "0").length);
		await page.locator(".map-2d .res[tabindex=\"0\"]").focus();
		const kbMonth2d = (await stateOf(page)).dateIndex;
		const kbFirst = await page.evaluate(() => document.activeElement.getAttribute("aria-label"));
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");
		const second = await page.evaluate(() => ({ label: document.activeElement.getAttribute("aria-label"), month: window.droughtViz.store.get().dateIndex, stops: [ ...document.querySelectorAll(".map-2d .res") ].filter((e) => e.getAttribute("tabindex") === "0").length }));
		await page.keyboard.press("Tab");
		const kbOut = await page.evaluate(() => document.activeElement.closest(".map-2d") ? "map" : "out");
		check("2D map is one tab stop; arrow keys move between reservoirs", kb === 1 && /^Shasta/.test(kbFirst) && second.label !== kbFirst && second.stops === 1 && kbOut === "out" && second.month === kbMonth2d, `${kb} tab stop, ${kbFirst} -> ${second.label}, Tab leaves the map: ${kbOut === "out"}`);
		await page.evaluate(() => document.activeElement.blur());
		check("2D map names southern reservoirs too", [ "Isabella", "Castaic", "Diamond Valley" ].every((n) => names2d.includes(n)) && names2d.length >= 10, names2d.join(", "));
		check("2D renders stream links", counts.streams === F.links, `${counts.streams} of ${F.links}`);
		check("2D reservoirs show storage", counts.filled === F.reporting, `${counts.filled} filled, ${F.reporting} with data`);

		// ---------- Data range ----------
		const ym = (m) => { const [ y, mo ] = m.split("-").map(Number); return y * 12 + mo - 1; };
		const first = F.months[0];
		const last = F.months[F.months.length - 1];
		const now = new Date();
		const prevMonth = now.getFullYear() * 12 + now.getMonth() - 1;
		check("Data starts in October 2011", first === "2011-10", first);
		check("Data runs to a recent complete month", ym(last) >= prevMonth - 3 && ym(last) <= prevMonth, `${last} (previous month ${Math.floor(prevMonth / 12)}-${String(prevMonth % 12 + 1).padStart(2, "0")})`);
		check("Months are contiguous", F.months.every((m, i) => i === 0 || ym(m) === ym(F.months[i - 1]) + 1), `${F.months.length} months`);
		const clash = [];
		const startIndex = (await stateOf(page)).dateIndex;
		for (const m of [ "2014-09", "2014-03", "2021-06" ]) {
			await setState(page, { dateIndex: await monthIndex(page, m) });
			clash.push(await page.evaluate(() => {
				const line = document.querySelector(".track .playhead line").getBoundingClientRect();
				return [ ...document.querySelectorAll(".track .band-label") ].filter((t) => t.style.display !== "none").some((t) => { const b = t.getBoundingClientRect(); return line.left > b.left - 1 && line.left < b.right + 1; });
			}));
		}
		await setState(page, { dateIndex: startIndex });
		check("The playhead never cuts through a drought-band label", !clash.some(Boolean), JSON.stringify(clash));
		const lede = await page.locator(".lede").innerText();
		check("Intro states the derived count and range", lede.includes(`${F.reporting} reservoirs`) && /October 2011/.test(lede) && lede.includes(last.slice(0, 4)), lede.slice(0, 90));
		check("Intro explains 35 vs tracked count", lede.includes(`Statewide totals use ${F.tracked.length} of them`), `tracked ${F.tracked.length}`);
		const tl = await page.evaluate(() => { const i = document.querySelector(".timeline input"); i.value = 40; i.dispatchEvent(new Event("input", { bubbles: true })); const a = document.querySelector(".date-readout").innerText; i.value = 0; i.dispatchEvent(new Event("input", { bubbles: true })); return { a, b: document.querySelector(".date-readout").innerText }; });
		check("Timeline readout flags drought-emergency months only", /drought emergency/.test(tl.a) && !/drought emergency/.test(tl.b), `${tl.a.replace("\n", " ")} | ${tl.b.replace("\n", " ")}`);
		const ac = await page.locator(".js-state-sub").innerText();
		check("Acre-feet abbreviation is spelled out", /acre-feet/.test(ac), ac);
		const lc = await page.evaluate(() => { const l = document.querySelector(".lede"), b = document.querySelector(".lede-toggle"); const vis = getComputedStyle(b).display !== "none"; const h0 = l.getBoundingClientRect().height; if (vis) b.click(); const h1 = l.getBoundingClientRect().height; if (vis) b.click(); return { vis, h0, h1, vw: innerWidth }; });
		check("Phone intro is clamped and expandable; desktop shows it whole", lc.vw <= 560 ? lc.vis && lc.h1 > lc.h0 : !lc.vis, JSON.stringify(lc));
		if (lc.vw > 900) check("Desktop dek is not truncated", await page.evaluate(() => { const l = document.querySelector(".lede"); return l.scrollHeight <= l.clientHeight + 1 && getComputedStyle(l).webkitLineClamp === "none"; }));
		const ticks = await page.evaluate(() => ({ ticks: document.querySelectorAll(".track .year-tick").length, labels: document.querySelectorAll(".track .year-tick text").length, bands: document.querySelectorAll(".track .drought-band").length }));
		check("Timeline has a tick per year and two drought bands", ticks.ticks >= Number(last.slice(0, 4)) - 2011 && ticks.bands === 2, JSON.stringify(ticks));
		const gaps = await page.evaluate(() => {
			const d = window.droughtViz.data;
			const dmv = d.byId.get("DMV");
			const i = d.months.indexOf("2012-11");
			return { filled: dmv.filled[i], value: dmv.series[i], inTotal: d.totals[i].filled.some((r) => r.id === "DMV"), reporting: d.totals[i].reporting, tracked: d.tracked.length };
		});
		check("Missing month (Diamond Valley 2012-11) is interpolated and flagged", gaps.filled === "interpolated" && gaps.value > 0 && gaps.inTotal && gaps.reporting === gaps.tracked, JSON.stringify(gaps));
		await setState(page, { dateIndex: await monthIndex(page, "2012-11") });
		check("Summary names the filled month", /Diamond Valley interpolated/.test(await page.locator(".js-note").innerText()));
		await setState(page, { dateIndex: F.months.length - 1 });
		check("Latest months are marked provisional", /provisional/i.test(await page.locator(".date-readout .meta").innerText()), await page.locator(".date-readout .meta").innerText());
		await setState(page, { dateIndex: await monthIndex(page, "2014-09") });

		// ---------- Colour ramp vs no data ----------
		const ramp = await page.evaluate(async () => {
			const { pctColor, NO_DATA_COLOR } = await import("/js/scales.js");
			const nd = window.d3.lab(NO_DATA_COLOR);
			let minChroma = Infinity;
			let minDist = Infinity;
			for (let k = 0; k <= 200; k++) {
				const c = pctColor(k / 200);
				const l = window.d3.lab(c);
				minChroma = Math.min(minChroma, window.d3.hcl(c).c);
				minDist = Math.min(minDist, Math.hypot(l.l - nd.l, l.a - nd.a, l.b - nd.b));
			}
			const pra = document.querySelector(".map-2d .res.no-data");
			return { minChroma, minDist, hollow: pra && +pra.querySelector(".res-fill").getAttribute("r") === 0, hatch: pra && getComputedStyle(pra.querySelector(".res-cap")).fill };
		});
		check("Ramp stays saturated (chroma >= 30 everywhere)", ramp.minChroma >= 30, `min chroma ${ramp.minChroma.toFixed(1)}`);
		check("Ramp stays far from the no-data neutral (Lab distance >= 25)", ramp.minDist >= 25, `min distance ${ramp.minDist.toFixed(1)}`);
		check("No data is drawn hollow and hatched, not grey-filled", ramp.hollow && /hatch-nodata/.test(ramp.hatch), ramp.hatch);

		// ---------- Flood control ----------
		const flood = await page.evaluate(() => {
			const d = window.droughtViz.data;
			const i = d.months.indexOf("2014-09");
			const t = d.totals[i];
			let s = 0, c = 0, low = 0;
			for (const r of d.reservoirs) {
				if (r.floodControl || r.series[i] === null) continue;
				s += r.series[i];
				c += r.capacity;
				if (r.series[i] / r.capacity < 0.4) low += 1;
			}
			const svo = d.byId.get("SVO");
			return { ok: Math.abs(t.pct - s / c) < 1e-9 && t.low === low, svoPct: svo.series[i] / svo.capacity, svoTracked: d.tracked.includes(svo), marks: document.querySelectorAll(".map-2d .res.flood").length };
		});
		check("Flood-control basins are tagged", F.flood.sort().join() === "PRA,SVO", F.flood.join());
		check("Flood-control basins are left out of the totals and the low count", flood.ok && !flood.svoTracked && flood.svoPct < 0.4, `Seven Oaks ${(flood.svoPct * 100).toFixed(1)}% full, excluded`);
		check("Flood-control basins have their own 2D mark", flood.marks === F.flood.length);
		check("Summary title counts the tracked reservoirs", (await page.locator(".js-state-title").innerText()).toLowerCase().startsWith(`${F.tracked.length} tracked reservoirs`), await page.locator(".js-state-title").innerText());
		await page.locator(".map-2d .res.flood").first().hover({ force: true });
		check("Flood-control tooltip explains it", /kept nearly empty by design/.test(await page.locator("#tooltip").innerText()));
		await page.mouse.move(5, 5);

		// ---------- Tooltip follows the date ----------
		await setState(page, { selected: "SHA", dateIndex: await monthIndex(page, "2014-09") });
		await page.locator(".map-2d .res[aria-label^=\"Shasta\"]").hover({ force: true });
		const tipBefore = await page.locator("#tooltip .tt-pct").innerText();
		await setState(page, { dateIndex: await monthIndex(page, "2017-04") });
		const tipAfter = { pct: await page.locator("#tooltip .tt-pct").innerText(), month: await page.locator("#tooltip .tt-month").innerText() };
		const card = { pct: await page.locator(".detail-grid .js-full").innerText(), month: await page.locator(".date-readout .month").innerText() };
		check("2D tooltip re-renders on a date change", tipBefore !== tipAfter.pct && tipAfter.month === card.month, `${tipBefore} -> ${tipAfter.pct}, ${tipAfter.month}`);
		check("2D tooltip agrees with the detail card", tipAfter.pct === card.pct, `tooltip ${tipAfter.pct}, card ${card.pct}`);
		await setState(page, { selected: null });
		await page.mouse.move(5, 5);

		// ---------- Contrast ----------
		const footer = await page.evaluate(() => {
			const lum = (c) => {
				const [ r, g, b ] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
					const x = +v / 255;
					return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const fg = lum(getComputedStyle(document.querySelector(".site-footer span")).color);
			const bg = lum(getComputedStyle(document.body).backgroundColor);
			return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
		});
		check("Footer text meets AA contrast (4.5:1)", footer >= 4.5, `${footer.toFixed(2)}:1`);

		await page.locator(".map-2d .res").first().hover({ force: true });
		const tip2d = await page.locator("#tooltip").innerText();
		check("2D hover shows tooltip", await page.locator("#tooltip").isVisible() && /Shasta/.test(tip2d), tip2d.split("\n")[0]);
		await page.mouse.move(5, 5);

		// Hit-testing: the point at each reservoir's centre belongs to that reservoir, even inside a bigger neighbour's ring.
		const hits = await page.evaluate(() => {
			const svg = document.querySelector(".map-2d");
			const box = svg.getBoundingClientRect();
			const wrong = [];
			let overlapped = 0;
			const marks = [ ...svg.querySelectorAll(".res") ];
			const at = (g) => { const m = g.getAttribute("transform").match(/translate\(([-\d.]+),([-\d.]+)\)/); return [ +m[1], +m[2] ]; };
			for (const g of marks) {
				const [ x, y ] = at(g);
				if (x < 0 || y < 0 || x > box.width || y > box.height) continue;
				if (marks.some((o) => o !== g && Math.hypot(at(o)[0] - x, at(o)[1] - y) < +o.querySelector(".res-cap").getAttribute("r"))) overlapped++;
				const hit = document.elementFromPoint(box.left + x, box.top + y)?.closest(".res");
				if (hit !== g) wrong.push(g.getAttribute("aria-label").split(":")[0]);
			}
			return { wrong, overlapped };
		});
		check("Hover targets the reservoir under the pointer, not a neighbour's ring", hits.wrong.length === 0 && hits.overlapped > 0, `${hits.overlapped} markers inside a neighbour's ring; wrong: ${hits.wrong.join(", ") || "none"}`);
		check("2D markers carry no dam bar that reads as a stand", (await page.locator(".map-2d .res .res-dam").count()) === 0);

		// Detail card scene: waterline follows % full, low lakes show a bathtub ring, full ones barely any.
		const scene = async (id, m) => {
			await setState(page, { selected: id, dateIndex: await monthIndex(page, m) });
			// The card's waterline animates; give slow software-rendered frames time to finish it.
			await page.waitForTimeout(3000);
			return page.evaluate(() => {
				const s = document.querySelector(".detail-dam");
				return { pct: +s.dataset.pct, water: +s.querySelector(".dam-water").getAttribute("y"), ring: +s.querySelector("clipPath rect").getAttribute("height"), low: s.classList.contains("low"), label: s.getAttribute("aria-label") };
			});
		};
		const sWet = await scene("ORO", "2017-04");
		const sDry = await scene("ORO", "2014-09");
		check("Detail scene waterline rises with % full", sDry.pct < sWet.pct && sDry.water > sWet.water, `${(sDry.pct * 100).toFixed(0)}% y=${sDry.water.toFixed(1)} vs ${(sWet.pct * 100).toFixed(0)}% y=${sWet.water.toFixed(1)}`);
		check("Low reservoir shows a bathtub ring above the water", sDry.low && sDry.ring > sWet.ring && sDry.ring > 20, `ring ${sDry.ring.toFixed(1)} vs ${sWet.ring.toFixed(1)}`);
		check("Detail scene is labelled with the % full", /Oroville/.test(sDry.label) && /of capacity/.test(sDry.label), sDry.label);
		await shot(page, "desktop-2d-detail-scene-drought.png", ".detail-card");
		await setState(page, { selected: null });

		// % of average: the statewide line for the same calendar month, low in the drought, high after 2017's wet winter.
		const avgOf = async (m) => { await setState(page, { dateIndex: await monthIndex(page, m) }); await page.waitForTimeout(100); return page.locator(".js-state-avg").innerText(); };
		const dryAvg = await avgOf("2014-09"), wetAvg = await avgOf("2017-04");
		const pctIn = (t) => +((t.match(/(\d+)% of average/) || [])[1] || NaN);
		check("Statewide storage is shown as % of the average for that month", /of average for September/.test(dryAvg) && /of average for April/.test(wetAvg), `${dryAvg} | ${wetAvg}`);
		check("Sep 2014 is well below average and Apr 2017 above it", pctIn(dryAvg) < 80 && pctIn(wetAvg) > 100, `${pctIn(dryAvg)}% vs ${pctIn(wetAvg)}%`);
		await setState(page, { dateIndex: await monthIndex(page, "2014-09") });
		const before = await page.locator(".js-state-pct").innerText();
		await page.locator(".timeline input[type=range]").focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
		const after = await page.locator(".js-state-pct").innerText();
		check("Timeline scrub changes statewide value", before !== after, `${before} -> ${after}`);
		check("Timeline scrub updates month label", /2016/.test(await page.locator(".date-readout .month").innerText()), await page.locator(".date-readout .month").innerText());

		check("Timeline marks the selected month with a playhead dot", (await page.locator(".track .playhead circle").count()) === 1);
		const ex = await page.evaluate(() => { const t = window.droughtViz.data.totals; const lo = t.reduce((m, d, i) => (d.pct < t[m].pct ? i : m), 0); return { lo, n: document.querySelectorAll(".track .extreme").length }; });
		check("Timeline marks the record low and high", ex.n === 2);
		await page.locator(".track .extreme").first().dispatchEvent("click");
		check("Clicking the low marker jumps to the lowest month", (await stateOf(page)).dateIndex === ex.lo, String((await stateOf(page)).dateIndex));
		await setState(page, { dateIndex: 40 });
		check("Summary shows change since the previous month", /since/.test(await page.locator(".js-state-delta").innerText()), await page.locator(".js-state-delta").innerText());
		await page.locator(".play-btn").click();
		const i0 = (await stateOf(page)).dateIndex;
		await page.waitForTimeout(1300);
		const s1 = await stateOf(page);
		check("Play advances the timeline", s1.playing && s1.dateIndex > i0, `${i0} -> ${s1.dateIndex}`);
		await page.locator(".play-btn").click();
		check("Pause stops the timeline", !(await stateOf(page)).playing);

		// Keyboard: arrows step a month (Shift a year), Space plays; speed button cycles 1x/2x/4x.
		await page.evaluate(() => { document.activeElement?.blur(); document.body.focus(); });
		await setState(page, { dateIndex: 40 });
		await page.keyboard.press("ArrowRight");
		check("Right arrow steps one month on the page", (await stateOf(page)).dateIndex === 41);
		await page.keyboard.press("Shift+ArrowLeft");
		check("Shift+Left arrow steps back a year", (await stateOf(page)).dateIndex === 29);
		await page.keyboard.press(" ");
		check("Space starts playback", (await stateOf(page)).playing);
		await page.keyboard.press(" ");
		check("Space pauses playback", !(await stateOf(page)).playing);
		await page.locator(".speed-btn").click();
		await page.locator(".speed-btn").click();
		check("Speed button cycles to 4x", /4/.test(await page.locator(".speed-btn").innerText()));
		await setState(page, { dateIndex: 10 });
		await page.locator(".play-btn").click();
		await page.waitForTimeout(1300);
		const fast = (await stateOf(page)).dateIndex - 10;
		await page.locator(".play-btn").click();
		check("4x playback advances faster than 1x would", fast >= 8, `${fast} months in 1.3 s`);
		await page.locator(".speed-btn").click();
		const fit = await page.evaluate(() => { const r = document.querySelector(".timeline").getBoundingClientRect(); return { b: r.bottom, vh: innerHeight, vw: innerWidth }; });
		check("Map, summary and timeline fit the first screen on desktop", fit.vw < 1000 || fit.b <= fit.vh, `timeline bottom ${Math.round(fit.b)} of ${fit.vh}`);
		// The timeline and the key events share a row: neither leaves an empty strip under it.
		const row = await page.evaluate(() => {
			const r = (q) => document.querySelector(q).getBoundingClientRect();
			const names = [ ...document.querySelectorAll(".event-name") ];
			return { panel: r(".timeline-panel").height, events: r(".key-events").height, spark: r(".timeline-panel .track svg").height, tlGap: r(".timeline-panel").bottom - r(".timeline-panel .timeline").bottom, listGap: r(".key-events").bottom - r(".event-list").bottom, cut: names.filter((n) => n.scrollWidth > n.clientWidth).length, vw: innerWidth };
		});
		check("Timeline and key events balance: no empty strip under either, event names whole", row.vw < 1000 || (Math.abs(row.panel - row.events) <= 2 && row.tlGap <= 2 && row.listGap <= 12 && row.spark >= 40 && row.cut === 0), JSON.stringify(row));

		await page.locator(".map-2d .res[aria-label^=\"Oroville\"]").click({ force: true });
		await page.waitForTimeout(300);
		check("2D click opens the detail card", await page.locator(".detail-card").isVisible() && /Oroville/.test(await page.locator(".detail-title").innerText()));
		check("Detail card has a storage sparkline", (await page.locator(".detail-spark .spark-line").count()) === 1);
		check("Sparkline shows capacity label and seasonal-average line", (await page.locator(".detail-spark .spark-cap").count()) === 1 && (await page.locator(".detail-spark .spark-avg").count()) === 1);
		await page.keyboard.press("Escape");
		check("Escape closes the detail card", !(await page.locator(".detail-card").isVisible()));

		// Sound: muted by default; a click builds the graph; a second click mutes.
		const s0 = await page.evaluate(() => window.droughtViz.audio.debugState());
		check("Sound is off by default", s0.context === "none" && s0.muted, JSON.stringify(s0));
		await page.locator(".sound-toggle").click();
		await page.waitForTimeout(800);
		const sOn = await page.evaluate(() => window.droughtViz.audio.debugState());
		check("Sound graph builds after a click", sOn.context === "running" && sOn.nodes > 10 && sOn.gain > 0.05, JSON.stringify(sOn));
		await page.locator(".sound-toggle").click();
		await page.waitForTimeout(900);
		const sOff = await page.evaluate(() => window.droughtViz.audio.debugState());
		check("Mute silences the output", sOff.muted && sOff.gain < 0.02, JSON.stringify(sOff));

		await setState(page, { dateIndex: await monthIndex(page, "2014-09") });
		await shot(page, "desktop-2d-light.png");
		await page.locator("#theme-toggle").click();
		check("Theme toggle switches to dark", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
		await page.waitForTimeout(300);
		await shot(page, "desktop-2d-dark.png");
		allErrors.push(...errors);
		await ctx.close();

		// ---------- Desktop 3D ----------
		({ ctx, page, errors } = await openPage(browser, base, { query: "?mode=3d&month=2014-09" }));
		await waitStill(page);
		const gl = await debug3d(page, "({ tris: c.renderer.info.render.triangles, calls: c.renderer.info.render.calls })");
		check("3D WebGL terrain renders", gl.tris > 100000, `${gl.tris} triangles, ${gl.calls} draw calls`);
		await shot(page, "3d-wide-drought-sep2014.png", ".stage");

		const lvlDry = await debug3d(page, "c.level('SHA')");
		await setState(page, { dateIndex: await monthIndex(page, "2017-04") });
		await page.waitForTimeout(2500);
		const lvlWet = await debug3d(page, "c.level('SHA')");
		check("Timeline raises Shasta's lake level", lvlWet - lvlDry > 0.5, `${lvlDry.toFixed(2)} -> ${lvlWet.toFixed(2)}`);
		await shot(page, "3d-wide-wet-apr2017.png", ".stage");

		const box = await page.locator("#view-3d").boundingBox();
		const [ sx, sy ] = await page.evaluate(() => window.droughtViz.views["3d"].screenPos("ORO"));
		await page.mouse.move(box.x + sx, box.y + sy);
		await page.waitForTimeout(400);
		const tip3d = await page.locator("#tooltip").innerText().catch(() => "");
		check("3D raycast hover shows tooltip", await page.locator("#tooltip").isVisible() && /Oroville/.test(tip3d), tip3d.split("\n")[0]);
		// The open tooltip in 3D follows the timeline too (the pointer stays still).
		const m3 = await page.locator("#tooltip .tt-month").innerText().catch(() => "");
		await setState(page, { dateIndex: await monthIndex(page, "2015-11") });
		const m3b = await page.locator("#tooltip .tt-month").innerText().catch(() => "");
		check("3D tooltip re-renders on a date change", m3 !== m3b && m3b === await page.locator(".date-readout .month").innerText(), `${m3} -> ${m3b}`);
		await setState(page, { dateIndex: await monthIndex(page, "2017-04") });
		await page.mouse.click(box.x + sx, box.y + sy);
		await page.waitForTimeout(300);
		const sel = await stateOf(page);
		check("3D click selects and starts a fly-to", sel.selected === "ORO" && (await debug3d(page, "c.moving()")), sel.selected);
		await waitStill(page);
		check("Fly-to brings the camera close", (await debug3d(page, "c.pose().dist")) < 120, `${(await debug3d(page, "c.pose().dist")).toFixed(0)} units`);
		await shot(page, "3d-oroville-wet.png", ".stage");

		// Every dam visibly releases water; the spillway cascade only runs above ~90% full.
		for (const month of [ "2014-09", "2017-04" ]) {
			await setState(page, { dateIndex: await monthIndex(page, month) });
			await page.waitForTimeout(3500);
			// SwiftShader can run at ~2 fps; let the eased spill values settle before judging them.
			await page.waitForFunction(() => window.droughtViz.views["3d"].debug().outflow().every((o) => (o.spill > 0.05) === (o.pct !== null && o.pct > 0.9)), null, { timeout: 15000, polling: 500 }).catch(() => {});
			const out = await debug3d(page, "c.outflow()");
			const wet = out.filter((o) => o.pct !== null && o.pct > 0.003);
			// Long enough to see, unless it runs straight into the next lake downstream.
			const bad = wet.filter((o) => !(o.width > 0.3 && (o.length > 3 || o.into || o.joins)));
			check(`${month}: every dam with water has a visible outflow`, wet.length > 30 && bad.length === 0, `${wet.length} dams, min width ${Math.min(...wet.map((o) => o.width)).toFixed(2)}${bad.length ? `, missing: ${bad.map((o) => o.id).join(",")}` : ""}`);
			const wrong = out.filter((o) => (o.spill > 0.05) !== (o.pct !== null && o.pct > 0.9));
			check(`${month}: spillway cascade only above 90% full`, wrong.length === 0, `${out.filter((o) => o.spill > 0.05).map((o) => o.id).join(",") || "none spilling"}${wrong.length ? `; wrong: ${wrong.map((o) => `${o.id}@${(o.pct * 100).toFixed(0)}%`).join(",")}` : ""}`);
		}

		// Rivers follow the month: narrower below the big dams in the drought than in the wet spring of 2017.
		const widthsAt = async (m) => {
			await setState(page, { dateIndex: await monthIndex(page, m) });
			await page.waitForTimeout(1500);
			return debug3d(page, "Object.fromEntries(c.outflow().map((o) => [ o.id, o.width ]))");
		};
		const wDry = await widthsAt("2014-09");
		const wWet = await widthsAt("2017-04");
		const bigDams = [ "SHA", "ORO", "CLE", "NML", "DNP", "FOL" ];
		check("Rivers below the big dams run narrower in the drought", bigDams.every((id) => wDry[id] < wWet[id]), bigDams.map((id) => `${id} ${wDry[id].toFixed(2)}→${wWet[id].toFixed(2)}`).join(", "));
		const clear = await debug3d(page, "c.chuteClearance()");
		check("Spillway chutes sit above the ground across their width", clear.length > 10 && Math.min(...clear) > 0, `${clear.length} chutes, min clearance ${Math.min(...clear).toFixed(2)}`);

		// Fly-to: the camera stays above the ground with the dam in view, for the big lakes.
		const flyIds = [ "SHA", "ORO", "CLE", "NML", "DNP", "BER", "ALM", "FOL", "PNF", "ISB", "MIL" ];
		const flyBad = [];
		for (const id of flyIds) {
			await debug3d(page, `c.focus("${id}")`);
			await page.waitForFunction(() => !window.droughtViz.views["3d"].debug().moving(), null, { timeout: 30000, polling: 200 }).catch(() => {});
			await page.waitForTimeout(400);
			const r = await debug3d(page, `({ clear: c.clearance(), dam: c.damInView("${id}"), dist: c.pose().dist })`);
			if (!(r.clear > 1 && r.dam && r.dist < 60)) flyBad.push(`${id} clear ${r.clear.toFixed(1)} dam ${r.dam} dist ${r.dist.toFixed(0)}`);
		}
		check("Fly-to keeps the camera above ground, close, with the dam in view", flyBad.length === 0, flyBad.join("; ") || `${flyIds.length} lakes`);
		// Zoomed right in over the steepest reservoirs: the camera stays well above the local
		// terrain (40% of its distance), sees the target past every wall, and the target sits in
		// the open part of the view, not under the detail card.
		const steepBad = [];
		for (const id of [ "PNF", "NML", "DNP", "ORO", "SHA" ]) {
			await setState(page, { selected: id });
			await waitStill(page, 400);
			const sp = (await debug3d(page, "c.viewCheck()")).screen;
			await page.mouse.move(sp[0], sp[1]);
			for (let k = 0; k < 16; k++) {
				await page.mouse.wheel(0, -400);
				await page.waitForTimeout(60);
			}
			await waitStill(page, 1200);
			const v = await debug3d(page, "c.viewCheck()");
			const card = await page.evaluate(() => { const c = document.querySelector(".detail-card"); if (!c || c.hidden) return null; const r = c.getBoundingClientRect(); return [ r.left, r.top, r.right, r.bottom ]; });
			const [ x, y ] = v.screen;
			const onCanvas = x > v.canvas[0] && x < v.canvas[2] && y > v.canvas[1] && y < v.canvas[3];
			const underCard = card && x > card[0] && x < card[2] && y > card[1] && y < card[3];
			if (!(v.ratio >= 0.38 && v.clear && onCanvas && !underCard)) steepBad.push(`${id} height/dist ${v.ratio.toFixed(2)} sight ${v.clear ? "clear" : "blocked"} at ${x.toFixed(0)},${y.toFixed(0)}${underCard ? " under card" : ""}`);
		}
		await setState(page, { selected: null });
		check("Zoomed in over the steepest lakes: above the terrain, clear sight line, target in view", steepBad.length === 0, steepBad.join("; ") || "PNF, NML, DNP, ORO, SHA");
		// Orbiting right down and zooming in cannot put the camera into the hills.
		await page.evaluate(() => { const c = window.droughtViz.views["3d"].debug(); const t = c.sc.controls.target; const p = c.sc.camera.position; p.set(t.x + 15, t.y - 3, t.z + 15); });
		// A frame or two later (SwiftShader frames can take most of a second).
		await page.waitForFunction(() => window.droughtViz.views["3d"].debug().clearance() > 1, null, { timeout: 6000, polling: 200 }).catch(() => {});
		check("Camera stays above the terrain when pushed into it", (await debug3d(page, "c.clearance()")) > 1, `${(await debug3d(page, "c.clearance()")).toFixed(2)} units`);
		const spike = await debug3d(page, "c.maxSpike()");
		check("No terrain spikes: every land cell within 220 m of its neighbours' mean", spike <= 221, `${spike.toFixed(0)} m`);
		const rip = await debug3d(page, "c.riparian()");
		const bays = await debug3d(page, "[ c.isSea(-122.3, 37.7), c.isSea(-122.35, 38.05), c.isSea(-121.6, 38.05) ]");
		check("San Francisco and San Pablo bays are water; the Delta islands stay land", bays[0] && bays[1] && !bays[2], JSON.stringify(bays));
		const rivers = await debug3d(page, "c.mainRivers()");
		check("Overview shows the main-stem rivers", [ "Sacramento", "Feather", "American", "San Joaquin" ].every((n) => rivers.includes(n)), rivers.join(", "));
		await page.waitForFunction(() => window.droughtViz.views["3d"].debug().riverLevelsReady(), null, { timeout: 30000 });
		const samples0 = await debug3d(page, "c.groundSamples()");
		for (const m of [ "2015-09", "2017-02", "2021-09" ]) await setState(page, { dateIndex: await monthIndex(page, m) });
		const samples1 = await debug3d(page, "c.groundSamples()");
		const gap1 = (await debug3d(page, "c.verifyWater()")).maxGap;
		check("A month change re-places the rivers without re-sampling the terrain, still on the ground", samples1 === samples0 && gap1 < 0.35, `${samples1 - samples0} ground samples over 3 month changes, max gap ${gap1} in Sep 2021`);
		const bare = await debug3d(page, "(() => { let n = 0; c.sc.scene.traverse((o) => { const a = o.geometry?.attributes?.bare; if (a) for (let i = 0; i < a.count; i++) n += a.getX(i) > 0.5; }); return n; })()");
		check("Exposed lake beds are marked bare, so the grass and fields shader skips them", bare > 1000, `${bare} lake-bed vertices`);
		const ww = await debug3d(page, "(() => { const w = c.waterways(); const near = (name, id) => { const b = c.basins.byId.get(id); const e = w.ends[name][1]; return Math.hypot(e[0] - b.cx, e[1] - b.cz); }; return { ...w, cas: near('West Branch', 'CAS'), prr: near('East Branch', 'PRR'), ids: window.droughtViz.data.reservoirs.map((r) => r.id) }; })()");
		check("Delta channels, California Aqueduct and Delta-Mendota Canal drawn; branches end at Castaic and Perris", ww.delta.includes("Old River") && [ "California Aqueduct", "West Branch", "East Branch", "Delta-Mendota Canal" ].every((n) => ww.canals.includes(n)) && ww.cas < 0.5 && ww.prr < 0.5, `${ww.delta.length} Delta channels, ${ww.canals.join(", ")}`);
		check("San Luis Reservoir is not added (line only)", !ww.ids.some((id) => /^(SNL|SLF|LUS)$/.test(id)) && !(await page.evaluate(() => window.droughtViz.data.reservoirs.some((r) => /san luis/i.test(r.name)))));
		const gentle = await debug3d(page, "Object.fromEntries([ 'DMV', 'PRR', 'ORO', 'PNF' ].map((id) => [ id, c.basins.byId.get(id).gentle ]))");
		check("Open-country lakes sit in a gentle saucer; canyon lakes keep steep sides", gentle.DMV > 0.5 && gentle.PRR > 0.5 && gentle.ORO < 0.2 && gentle.PNF < 0.2, JSON.stringify(Object.fromEntries(Object.entries(gentle).map(([ k, v ]) => [ k, +v.toFixed(2) ]))));
		const gold = [];
		for (const m of [ "2017-04", "2014-09" ]) {
			await setState(page, { dateIndex: await monthIndex(page, m) });
			gold.push(await debug3d(page, "c.gold()"));
		}
		check("Grass is golden in a drought September, green in a wet April", gold[1] > 0.7 && gold[0] < 0.2, `Apr 2017 ${gold[0].toFixed(2)}, Sep 2014 ${gold[1].toFixed(2)}`);
		const rf = await debug3d(page, "c.riparian()");
		check("Woodland and shrubs beyond the river banks", rf.forest > 1000 && rf.shrub > 500, `${rf.forest} forest trees, ${rf.shrub} shrubs`);
		check("No lake water above the shoreline: the water fades out where the bed meets the level", await debug3d(page, "c.lakeEdgeSoft()"));
		check("Rivers have trees and boulders along their banks", rip.pine + rip.broad > 1000 && rip.rock > 200, `${rip.pine} conifers, ${rip.broad} broadleaf, ${rip.rock} boulders`);
		check("Bank trees grow only on vegetated ground", rip.minVeg >= 0.05, `lowest vegetation under a tree ${rip.minVeg.toFixed(2)}`);
		const homeDist = await page.evaluate(() => { const v = window.droughtViz.views["3d"].debug(); return v.sc.camera.aspect >= 1 ? 1180 : 1700; });
		check("Bank trees fade out well before the state overview", rip.fade[1] < homeDist / 2, `gone by ${rip.fade[1]} units; overview at ${homeDist}`);
		const aniso = await debug3d(page, "[ c.anisotropy(), c.renderer.capabilities.getMaxAnisotropy() ]");
		check("Terrain detail texture uses the GPU's full anisotropic filtering", aniso[0] === aniso[1] && aniso[0] >= 1, `${aniso[0]} of ${aniso[1]}`);
		// Zooming in hard with the wheel stops at the minimum distance, toward the cursor.
		await debug3d(page, "c.focus('NML')");
		await page.waitForFunction(() => !window.droughtViz.views["3d"].debug().moving(), null, { timeout: 30000, polling: 200 }).catch(() => {});
		const zb = await page.locator("#view-3d").boundingBox();
		const t0 = await debug3d(page, "c.sc.controls.target.toArray()");
		await page.mouse.move(zb.x + zb.width * 0.7, zb.y + zb.height * 0.6);
		for (let k = 0; k < 25; k++) {
			await page.mouse.wheel(0, -400);
			await page.waitForTimeout(40);
		}
		await page.waitForTimeout(1200);
		const z1 = await debug3d(page, "({ dist: c.pose().dist, min: c.sc.controls.minDistance, t: c.sc.controls.target.toArray(), clear: c.clearance() })");
		check("Zoom stops at the minimum distance and above the ground", z1.dist >= z1.min - 0.5 && z1.clear > 1, `${z1.dist.toFixed(1)} (min ${z1.min}), clearance ${z1.clear.toFixed(1)}`);
		check("Wheel zoom moves toward the cursor", Math.hypot(z1.t[0] - t0[0], z1.t[2] - t0[2]) > 1, `target moved ${Math.hypot(z1.t[0] - t0[0], z1.t[2] - t0[2]).toFixed(1)} units`);
		await debug3d(page, "c.home()");
		await waitStill(page, 500);
		// Wheel zoom eases: a burst of notches zooms in (then out) monotonically, never more than
		// about 12% in one frame, and the ground point under the cursor stays under it.
		const easeRun = async (dir) => {
			const box = await page.locator("#view-3d canvas").boundingBox();
			const x = box.x + box.width * 0.55;
			const y = box.y + box.height * 0.55;
			const anchor = await debug3d(page, `c.groundUnder(${x}, ${y})`);
			await page.evaluate((a) => {
				const c = window.droughtViz.views["3d"].debug();
				window.__zl = [];
				const f = () => {
					window.__zl.push({ d: c.pose().dist, s: c.toClient(a) });
					window.__zlr = requestAnimationFrame(f);
				};
				window.__zlr = requestAnimationFrame(f);
			}, anchor);
			await page.mouse.move(x, y);
			for (let k = 0; k < 8; k++) {
				await page.mouse.wheel(0, dir * 100);
				await page.waitForTimeout(16);
			}
			await page.waitForTimeout(300);
			await waitStill(page, 300);
			const log = await page.evaluate(() => { cancelAnimationFrame(window.__zlr); return window.__zl; });
			let mono = true;
			let step = 0;
			let drift = 0;
			for (let i = 1; i < log.length; i++) {
				const r = Math.log(log[i].d / log[i - 1].d);
				if (r * dir < -1e-6) mono = false;
				step = Math.max(step, Math.abs(r));
				drift = Math.max(drift, Math.hypot(log[i].s[0] - x, log[i].s[1] - y));
			}
			return { mono, step: Math.exp(step) - 1, drift, from: log[0].d, to: log[log.length - 1].d, frames: log.length };
		};
		const zin = await easeRun(-1);
		const zout = await easeRun(1);
		const lim = await debug3d(page, "[ c.sc.controls.minDistance, c.sc.controls.maxDistance ]");
		check("Wheel zoom eases smoothly toward the cursor, in and out", zin.mono && zout.mono && zin.to < zin.from * 0.6 && zout.to > zout.from * 1.6 && Math.max(zin.step, zout.step) < 0.13 && Math.max(zin.drift, zout.drift) < 4 && zin.to >= lim[0] && zout.to <= lim[1],
			`in ${zin.from.toFixed(0)}->${zin.to.toFixed(0)} over ${zin.frames} frames, out ->${zout.to.toFixed(0)}; largest step ${(100 * Math.max(zin.step, zout.step)).toFixed(1)}%/frame; cursor point drift ${Math.max(zin.drift, zout.drift).toFixed(1)} px`);
		await debug3d(page, "c.home()");
		await waitStill(page, 500);
		await zoomChecks(page);
		// Keyboard zoom (+ and -) for people who cannot use a wheel or pinch; it tilts toward an oblique view close up.
		const k0 = await debug3d(page, "c.pose()");
		await page.focus("#view-3d canvas");
		for (let k = 0; k < 3; k++) {
			await page.keyboard.press("+");
			await waitStill(page, 600);
		}
		const k1 = await debug3d(page, "c.pose()");
		await page.keyboard.press("-");
		await waitStill(page, 600);
		const k2 = await debug3d(page, "c.pose()");
		check("Keyboard + and - zoom the 3D view", k1.dist < k0.dist * 0.6 && k2.dist > k1.dist * 1.2, `${k0.dist.toFixed(1)} -> ${k1.dist.toFixed(1)} -> ${k2.dist.toFixed(1)}, polar ${k0.polar.toFixed(2)} -> ${k1.polar.toFixed(2)}`);

		// Water on the ground: strips sit on the terrain and never run uphill.
		const water = await debug3d(page, "c.verifyWater()");
		check("Rivers and outflows lie on the terrain", water.maxGap < 0.35, `max gap ${water.maxGap} (${water.worst}), ${water.strips} strips`);
		check("Rivers and outflows only run downhill", water.maxClimb <= 0.46, `max climb ${water.maxClimb}`);
		// No river stops dead on a slope: each one meets another river, a main stem, a lake or the
		// sea, or fades out (dwindling) where the ground levels out or holds it in a hollow.
		const ends = await debug3d(page, "c.riverEndings()");
		const dangling = ends.filter((e) => e.ending === "fade" && !(e.drop >= -0.2 || e.slope < 0.1));
		const endCounts = ends.reduce((m, e) => ({ ...m, [e.ending]: (m[e.ending] ?? 0) + 1 }), {});
		check("No river ends dangling on a slope", ends.length >= 30 && dangling.length === 0, `${Object.entries(endCounts).map(([ k, v ]) => `${k} ${v}`).join(", ")}${dangling.length ? `; dangling: ${dangling.map((e) => `${e.id} slope ${e.slope} drop ${e.drop}`).join(", ")}` : ""}`);
		// Every outflow starts at its dam and every inflow reaches the water, in a drought, a wet
		// spring, the statewide low and each lake's own record low; no line has a gap in it.
		const riverGaps = await debug3d(page, `(() => {
			const d = window.droughtViz.data;
			const sets = [ "2014-09", "2017-04", "2015-09" ].map((m) => [ d.months.indexOf(m), null ]);
			d.reservoirs.forEach((r) => {
				let bi = -1;
				r.series.forEach((v, i) => { if (v !== null && (bi < 0 || v < r.series[bi])) bi = i; });
				if (bi >= 0) sets.push([ bi, r.id ]);
			});
			const bad = { dam: [], water: [], line: [] };
			let checked = 0;
			for (const [ m, only ] of sets) {
				for (const g of c.riverGaps(m)) {
					if (only && g.id !== only) continue;
					checked++;
					const at = d.months[m] + " " + g.id;
					if (!g.hasOut || g.damGap > 1.0) bad.dam.push(at + " " + g.damGap?.toFixed(2));
					if (!g.hasIn || g.waterGap > 0.3) bad.water.push(at + " " + g.waterGap?.toFixed(2));
					if (g.lineGap > 2.5) bad.line.push(at + " " + g.lineGap.toFixed(2));
				}
			}
			return { checked, bad };
		})()`);
		check("Every outflow starts at its dam (drought, wet, lows)", riverGaps.checked > 100 && riverGaps.bad.dam.length === 0, `${riverGaps.checked} lake-months${riverGaps.bad.dam.length ? `; ${riverGaps.bad.dam.slice(0, 6).join(", ")}` : ""}`);
		check("Every inflow reaches the current water (drought, wet, lows)", riverGaps.bad.water.length === 0, riverGaps.bad.water.slice(0, 6).join(", ") || "none short");
		check("No gaps inside any river line", riverGaps.bad.line.length === 0, riverGaps.bad.line.slice(0, 6).join(", ") || "none");
		// A river that ends at a main stem ends on the drawn main-stem ribbon (the same ribbon is
		// drawn at every zoom, so this holds at the overview, mid and close zooms), and no river
		// line hooks or doubles back on itself.
		const stemJoin = await debug3d(page, `(() => {
			const sp = c.stemPoints();
			const off = c.riverEndings().filter((e) => e.ending === "stem").filter((e) => !sp.some((p) => Math.hypot(p[0] - e.x, p[1] - e.z) < 2.5));
			const hooks = c.riverLinks().filter((l) => l.turn > 120).map((l) => l.id + (l.kind ? " inflow " : " outflow ") + l.turn.toFixed(0));
			return { stems: c.riverEndings().filter((e) => e.ending === "stem").length, off: off.map((e) => e.id), hooks, ribbon: sp.length };
		})()`);
		check("Rivers that reach a main stem end on the drawn main-stem ribbon", stemJoin.stems >= 8 && stemJoin.ribbon > 500 && stemJoin.off.length === 0, `${stemJoin.stems} joins, ${stemJoin.ribbon} ribbon points${stemJoin.off.length ? `; off the ribbon: ${stemJoin.off.join(", ")}` : ""}`);
		check("No river line turns back on itself (no hooks over 120 degrees)", stemJoin.hooks.length === 0, stemJoin.hooks.join(", ") || "none");
		const longOut = await debug3d(page, "c.outflow().filter((o) => o.length >= 8 || o.joins).length");
		const nOut = await debug3d(page, "c.outflow().length");
		check("Most outflows run well downstream", longOut >= 28, `${longOut} of ${nOut} longer than 8 units or joining a bigger river`);

		// 3D labels: text stays fully opaque; only the plate fades.
		const lbl = await page.evaluate(() => [ ...document.querySelectorAll(".labels-3d .lbl-text") ]
			.filter((e) => e.offsetParent && getComputedStyle(e).visibility !== "hidden")
			.map((e) => +getComputedStyle(e).opacity));
		check("3D label text is never faded", lbl.length > 0 && lbl.every((o) => o === 1), `${lbl.length} visible labels`);

		// Gauge links are data: hidden by default, shown for a selection or with the toggle.
		await setState(page, { selected: null });
		await page.mouse.move(box.x + 5, box.y + 5);
		await page.waitForTimeout(400);
		check("No gauge links visible by default", (await debug3d(page, "c.linksVisible()")) === 0);
		await page.locator(".js-links").click();
		await page.waitForTimeout(300);
		check("Gauge links toggle shows all links", (await debug3d(page, "c.linksVisible()")) === (await facts(page)).links);
		await shot(page, "3d-gauge-links-on.png", ".stage");
		await page.locator(".js-links").click();
		await setState(page, { selected: "PNF" });
		await page.waitForTimeout(300);
		check("Selecting a reservoir shows only its gauge links", (await debug3d(page, "c.linksVisible()")) === 1);
		await setState(page, { selected: null });

		const closeUps = [
			[ "SHA", "2014-09", "day", "3d-shasta-drought.png" ],
			[ "SHA", "2017-04", "day", "3d-shasta-wet-spilling.png" ],
			[ "SHA", "2017-04", "night", "3d-shasta-wet-night.png" ],
			[ "WSN", "2017-04", "day", "3d-wishon-apr2017-day.png" ],
			[ "WSN", "2017-04", "night", "3d-wishon-apr2017-night.png" ],
			[ "FOL", "2014-09", "day", "3d-folsom-drought.png" ],
			[ "FOL", "2014-09", "night", "3d-folsom-drought-night.png" ],
			[ "ORO", "2017-04", "day", "3d-oroville-apr2017.png" ],
			[ "ORO", "2017-04", "night", "3d-oroville-apr2017-night.png" ],
			[ "PNF", "2014-09", "day", "3d-pineflat-sep2014-day.png" ],
			[ "PNF", "2014-09", "night", "3d-pineflat-sep2014-night.png" ],
		];
		for (const [ id, month, sky, file ] of closeUps) {
			await page.selectOption(".js-sky", sky);
			await setState(page, { dateIndex: await monthIndex(page, month), selected: id });
			await waitStill(page, 3000);
			await shot(page, file, ".stage");
			if (sky === "night" && id === "PNF") {
				// The moon's reflection path runs through the middle of the view: moon ahead, at the view's pitch.
				const mv = await debug3d(page, "(() => { const m = c.sc.scene && window.droughtViz.views['3d'].debug(); const f = c.sc.controls.target.clone().sub(c.sc.camera.position).normalize(); const d = c.moonDir(); return { cos: f.x * d.x + f.y * -d.y + f.z * d.z, y: d.y }; })()");
				check("Night: the moon sits ahead of the camera so lakes show its path", mv.cos > 0.95 && mv.y > 0.1, `alignment ${mv.cos.toFixed(3)}`);
			}
		}
		await page.selectOption(".js-sky", "day");

		// Same dams from behind (upstream), the side and low down, to catch floating or upright water.
		const orbit = async (daz, dpol) => page.evaluate(([a, b]) => {
			const c = window.droughtViz.views["3d"].debug();
			const h = window.__pose;
			const az = h.az + a;
			const pol = Math.min(1.42, h.polar + b);
			const d = h.dist * (b ? 0.7 : 1);
			const t = h.target;
			c.sc.controls.target.set(...t);
			c.sc.camera.position.set(t[0] + Math.sin(pol) * Math.sin(az) * d, t[1] + Math.cos(pol) * d, t[2] + Math.sin(pol) * Math.cos(az) * d);
			c.sc.controls.update();
		}, [ daz, dpol ]);
		for (const [ id, month, sky ] of [ [ "PNF", "2014-09", "night" ], [ "WSN", "2017-04", "day" ], [ "SHA", "2017-04", "night" ], [ "ORO", "2017-04", "day" ], [ "FOL", "2014-09", "night" ] ]) {
			await page.selectOption(".js-sky", sky);
			await setState(page, { dateIndex: await monthIndex(page, month), selected: id });
			await waitStill(page, 1500);
			await page.evaluate(() => { window.__pose = window.droughtViz.views["3d"].debug().pose(); });
			for (const [ name, a, b ] of [ [ "behind", Math.PI, 0 ], [ "side", Math.PI / 2, 0 ], [ "low", 0.4, 0.38 ] ]) {
				await orbit(a, b);
				await page.waitForTimeout(1200);
				await shot(page, `3d-angle-${id.toLowerCase()}-${name}-${sky}.png`, ".stage");
			}
		}
		await page.selectOption(".js-sky", "day");
		await setState(page, { selected: null });

		await page.selectOption(".js-sky", "golden");
		await page.waitForTimeout(400);
		check("Time of day switches to golden hour", (await debug3d(page, "c.presetName")) === "Golden hour");
		await shot(page, "3d-folsom-golden.png", ".stage");
		await page.selectOption(".js-sky", "night");
		await setState(page, { selected: null });
		await page.locator("#reset-view").click();
		await waitStill(page);
		await shot(page, "3d-wide-night.png", ".stage");
		await page.selectOption(".js-sky", "day");

		await page.locator(".js-compare").click();
		await page.waitForTimeout(1500);
		check("Compare mode shows the split", await page.locator(".compare-split").isVisible());
		await waitStill(page);
		const cmp = await debug3d(page, "({ az: c.pose().az, ribbons: c.ribbonCompare() })");
		check("Compare from the overview turns the state across the screen, so both halves hold reservoirs", Math.abs(cmp.az + 1.02) < 0.05, `azimuth ${cmp.az.toFixed(2)}`);
		check("Compare: the left half draws its own month's river widths, then the main widths come back", cmp.ribbons.placed && cmp.ribbons.mainBound, JSON.stringify(cmp.ribbons));
		const halves = await page.evaluate(() => {
			const layers = [ ...document.querySelectorAll(".labels-3d") ];
			const dots = (l) => [ ...l.querySelectorAll(".lbl") ].filter((e) => e.style.display !== "none").map((e) => e.querySelector(".lbl-dot").style.background);
			return { layers: layers.length, left: dots(layers[1] ?? layers[0]), right: dots(layers[0]), stats: [ ...document.querySelectorAll(".compare-stat") ].map((p) => p.textContent) };
		});
		check("Compare: each half shows its own month's reservoir dots and a statewide summary", halves.layers === 2 && halves.left.length >= 6 && halves.right.length >= 4 && halves.stats.length === 2 && halves.stats[0] !== halves.stats[1] && halves.stats.every((t) => /full statewide/.test(t) && /Shasta/.test(t)), `${halves.left.length} dots left, ${halves.right.length} right; ${halves.stats.map((t) => t.split(" full")[0]).join(" vs ")}`);
		const nd = await debug3d(page, "c.northDeg()");
		check("A north arrow turns with the camera (north points left in the compare framing)", nd < -60 && nd > -120, `${nd} deg`);
		await shot(page, "3d-compare.png", ".stage");
		await page.locator(".js-compare").click();
		await waitStill(page);
		await page.locator("#view-3d canvas").focus();
		const kbMonth = (await stateOf(page)).dateIndex;
		await page.keyboard.press("ArrowRight");
		const kb1 = await debug3d(page, "c.keyboardPick()");
		await page.keyboard.press("ArrowDown");
		const kb2 = await debug3d(page, "c.keyboardPick()");
		const kbTip = await page.locator("#tooltip").innerText();
		await page.keyboard.press("Enter");
		await page.waitForTimeout(300);
		const kbState = await stateOf(page);
		const kbSel = kbState.selected;
		check("3D keyboard: arrows move between lakes (announced in the live tooltip), Enter flies to one, the month stays put", kb1 && kb2 && kb1 !== kb2 && kbSel === kb2 && kbTip.length > 0 && kbState.dateIndex === kbMonth, `${kb1} -> ${kb2}, selected ${kbSel}, month ${kbMonth} -> ${kbState.dateIndex}`);
		await page.keyboard.press("Escape");
		await waitStill(page);
		await page.evaluate(() => document.activeElement.blur());

		// Per-dam sound: level follows storage + release; spillway layer above ~90% full.
		await page.locator(".sound-toggle").click();
		await page.waitForTimeout(500);
		const damSound = async (month) => {
			await setState(page, { dateIndex: await monthIndex(page, month), selected: "SHA" });
			await waitStill(page, 2500);
			return page.evaluate(() => window.droughtViz.audio.debugLevels());
		};
		const dry = await damSound("2014-09");
		const wet = await damSound("2017-04");
		const voice = (d, id) => d.voices.find((v) => v.id === id) ?? { live: 0, crash: 0 };
		check("Shasta's dam voice is much louder in Apr 2017 than Sep 2014", voice(wet, "SHA").live > 1.8 * voice(dry, "SHA").live,
			`gain ${voice(dry, "SHA").live.toFixed(3)} -> ${voice(wet, "SHA").live.toFixed(3)}`);
		check("A small, low reservoir is far quieter than Shasta", wet.levels.BLB.level < 0.3 * wet.levels.SHA.level && dry.levels.BLB.level < 0.3 * dry.levels.SHA.level,
			`Black Butte ${dry.levels.BLB.level} vs Shasta ${dry.levels.SHA.level} (Sep 2014)`);
		check("Spillway layer only when over 90% full", voice(wet, "SHA").crash > 0.05 && voice(dry, "SHA").crash === 0 && wet.levels.SHA.spill > 0,
			`crash ${voice(dry, "SHA").crash} -> ${voice(wet, "SHA").crash.toFixed(3)}`);
		check("Detail card shows the dam's sound level", /spilling/.test(await page.locator(".detail-sound-val").innerText()));
		await page.locator(".detail-listen").click();
		await page.waitForTimeout(300);
		check("Listen solos the selected dam", (await page.evaluate(() => window.droughtViz.audio.solo)) === "SHA");
		await page.locator(".detail-listen").click();
		await page.locator(".sound-toggle").click();
		await setState(page, { selected: null });

		await page.locator(".js-replay").click();
		await page.waitForTimeout(3500);
		const rp = await stateOf(page);
		check("Drought replay runs the months", rp.dateIndex > 1, `month index ${rp.dateIndex}`);
		await shot(page, "3d-replay.png", ".stage");
		await page.locator(".js-replay").click();
		check("Replay stops on request", (await page.locator(".js-replay").getAttribute("aria-pressed")) === "false");
		allErrors.push(...errors);
		await ctx.close();

		// ---------- Reduced motion: replay cuts between stops ----------
		({ ctx, page, errors } = await openPage(browser, base, { query: "?mode=3d", reducedMotion: "reduce" }));
		await waitStill(page, 500);
		await page.locator(".js-replay").click();
		const poses = [];
		for (let k = 0; k < 40; k++) {
			poses.push(await debug3d(page, "(() => { const p = c.pose(); return [ p.dist, p.az, p.polar, ...p.target ].map((v) => v.toFixed(2)).join(','); })()"));
			await page.waitForTimeout(100);
		}
		const changes = poses.filter((p, k) => k > 0 && p !== poses[k - 1]).length;
		const rm = await stateOf(page);
		check("Reduced motion: replay cuts between stops instead of flying", changes <= 2 && rm.dateIndex > 3, `${changes} camera changes in 4 s, month index ${rm.dateIndex}`);
		await page.locator(".js-replay").click();
		allErrors.push(...errors);
		await ctx.close();

		// ---------- iPhone 12 ----------
		for (const scheme of [ "light", "dark" ]) {
			for (const mode of [ "2d", "3d" ]) {
				({ ctx, page, errors } = await openPage(browser, base, { phone: true, scheme, query: `?mode=${mode}` }));
				if (mode === "3d") await waitStill(page, 1500);
				else await page.waitForTimeout(400);
				check(`iPhone 12 ${mode} ${scheme}: no horizontal scroll`, await noHScroll(page));
				if (mode === "3d" && scheme === "light") {
					check("iPhone 12 defaults to low quality", (await page.locator(".js-quality").inputValue()) === "low");
					const ripLow = await debug3d(page, "c.riparian()");
					check("Low quality keeps trees light", ripLow.bank <= 2200 && ripLow.forest <= 1600 && ripLow.shrub <= 1200 && ripLow.rock <= 400, `${ripLow.bank} bank + ${ripLow.forest} forest trees, ${ripLow.shrub} shrubs, ${ripLow.rock} boulders`);
					check("Bank trees are skipped at the overview", !(await debug3d(page, "c.sc.scene.getObjectByName('riparian').visible")));
					const phoneNamed = await page.evaluate(() => {
						const byName = new Map(window.droughtViz.data.reservoirs.map((r) => [ r.name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir)$/, ""), r ]));
						return [ ...document.querySelectorAll(".labels-3d .lbl") ].filter((e) => e.style.display !== "none" && !e.querySelector(".lbl-text").classList.contains("far")).map((e) => byName.get(e.querySelector(".lbl-name").textContent)).filter(Boolean).map((r) => ({ id: r.id, lat: r.lat }));
					});
					const overlaps = async () => {
						const boxes = await page.evaluate(() => [ ...document.querySelectorAll(".labels-3d .lbl-text:not(.far)") ].filter((t) => t.closest(".lbl").style.display !== "none").map((t) => t.getBoundingClientRect()).map((b) => [ b.left, b.top, b.right, b.bottom ]));
						return boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]));
					};
					let overlap = await overlaps();
					// Values change the text width: still no overlaps after a month change (labels re-measure).
					await setState(page, { dateIndex: await monthIndex(page, "2017-02") });
					await page.waitForTimeout(300);
					overlap = overlap || await overlaps();
					check("iPhone 12 overview names at least 6 reservoirs, southern ones too, none overlapping", phoneNamed.length >= 6 && phoneNamed.some((r) => r.lat < 35) && !overlap, `${phoneNamed.map((r) => r.id).join(", ")}${overlap ? "; names overlap" : ""}`);
					await page.locator(".js-compare").click();
					await waitStill(page);
					const pc = await page.evaluate(() => {
						const split = document.querySelector(".compare-split");
						const chips = [ ...split.querySelectorAll(".compare-tag") ].map((t) => t.getBoundingClientRect());
						const layers = [ ...document.querySelectorAll(".labels-3d") ];
						const vis = (l) => [ ...l.querySelectorAll(".lbl") ].filter((e) => e.style.display !== "none");
						const names = layers.flatMap((l) => vis(l).map((e) => e.querySelector(".lbl-text")).filter((t) => !t.classList.contains("far")).map((t) => t.getBoundingClientRect()));
						const under = names.some((b) => chips.some((c) => b.left < c.right && b.right > c.left && b.top < c.bottom && b.bottom > c.top));
						return { stacked: split.classList.contains("stacked"), top: vis(layers[1] ?? layers[0]).length, bottom: vis(layers[0]).length, under, az: window.droughtViz.views["3d"].debug().pose().az };
					});
					check("iPhone 12 compare splits top/bottom with north up, lakes in both halves, no name under a chip", pc.stacked && Math.abs(pc.az) < 0.05 && pc.top >= 6 && pc.bottom >= 4 && !pc.under, JSON.stringify(pc));
					await shot(page, "iphone12-3d-compare.png", ".viz-card");
					await page.locator(".js-compare").click();
					await waitStill(page);
					await page.locator("#view-3d").scrollIntoViewIfNeeded();
					const b2 = await page.locator("#view-3d").boundingBox();
					const [ x, y ] = await page.evaluate(() => window.droughtViz.views["3d"].screenPos("SHA"));
					await page.touchscreen.tap(b2.x + x, b2.y + y);
					await page.waitForTimeout(500);
					check("iPhone 12 3D tap opens the detail card", await page.locator(".detail-card").isVisible());
					await waitStill(page, 2000);
					await shot(page, "iphone12-3d-shasta.png", ".viz-card");
					await setState(page, { selected: null });
				}
				await page.evaluate(() => window.scrollTo(0, 0));
				await shot(page, `iphone12-${mode}-${scheme}.png`);
				allErrors.push(...errors);
				await ctx.close();
			}
		}

		check("No preload warnings (each preload is used, with matching credentials)", preloadWarnings.length === 0, preloadWarnings.slice(0, 2).join(" | "));
		check("Zero console errors", allErrors.length === 0, allErrors.slice(0, 3).join(" | "));
	} finally {
		await browser.close();
		server.close();
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${path.relative(ROOT, SHOTS)}/`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
