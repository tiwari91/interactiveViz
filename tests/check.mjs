// End-to-end checks for the drought visualization, run in headless Chromium.
//   CHROME_BIN=/path/to/chrome-headless-shell node tests/check.mjs
// Serves the repo on a free port, runs the checks, saves screenshots to tests/screenshots/.
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? "/Users/shankartiwar/Cayuse/s2s-web-client/package.json");
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
function check(name, ok, detail = "") {
	results.push({ name, ok: Boolean(ok), detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function openPage(browser, base, { phone = false, scheme = "light", query = "", noWebGL = false } = {}) {
	const ctx = await browser.newContext({ ...(phone ? devices["iPhone 12"] : { viewport: { width: 1440, height: 1000 } }), colorScheme: scheme });
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
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${base}/${query}`);
	await page.waitForFunction(() => document.body.dataset.ready === "true", null, { timeout: 120000, polling: 500 });
	return { ctx, page, errors };
}

const stateOf = (page) => page.evaluate(() => window.droughtViz.store.get());
const setState = (page, patch) => page.evaluate((p) => window.droughtViz.store.set(p), patch);
const monthIndex = (page, m) => page.evaluate((x) => window.droughtViz.data.months.indexOf(x), m);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
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

async function main() {
	fs.mkdirSync(SHOTS, { recursive: true });
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await chromium.launch({
		executablePath: process.env.CHROME_BIN || undefined,
		args: [ "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=user-gesture-required" ],
	});
	const allErrors = [];

	try {
		// ---------- Default mode and WebGL fallback ----------
		let { ctx, page, errors } = await openPage(browser, base);
		check("Default view is 3D", (await stateOf(page)).mode === "3d" && (await page.locator("#view-3d canvas").count()) === 1);
		check("Loading overlay clears after 3D builds", await page.locator("#loading.done").count() === 1);
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
		const counts = await page.evaluate(() => ({
			counties: document.querySelectorAll(".map-2d .county").length,
			reservoirs: document.querySelectorAll(".map-2d .res").length,
			streams: document.querySelectorAll(".map-2d .stream-flow").length,
			filled: [ ...document.querySelectorAll(".map-2d .res-fill") ].filter((c) => +c.getAttribute("r") > 0).length,
		}));
		check("2D map renders 58 counties", counts.counties === 58, `${counts.counties}`);
		check("2D renders all reservoirs", counts.reservoirs === 36, `${counts.reservoirs}`);
		check("2D renders stream links", counts.streams > 40, `${counts.streams}`);
		check("2D reservoirs show storage", counts.filled > 30, `${counts.filled} filled`);

		await page.locator(".map-2d .res").first().hover();
		const tip2d = await page.locator("#tooltip").innerText();
		check("2D hover shows tooltip", await page.locator("#tooltip").isVisible() && /Shasta/.test(tip2d), tip2d.split("\n")[0]);
		await page.mouse.move(5, 5);

		const before = await page.locator(".js-state-pct").innerText();
		await page.locator(".timeline input[type=range]").focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
		const after = await page.locator(".js-state-pct").innerText();
		check("Timeline scrub changes statewide value", before !== after, `${before} -> ${after}`);
		check("Timeline scrub updates month label", /2016/.test(await page.locator(".date-readout .month").innerText()), await page.locator(".date-readout .month").innerText());

		await page.locator(".play-btn").click();
		const i0 = (await stateOf(page)).dateIndex;
		await page.waitForTimeout(1300);
		const s1 = await stateOf(page);
		check("Play advances the timeline", s1.playing && s1.dateIndex > i0, `${i0} -> ${s1.dateIndex}`);
		await page.locator(".play-btn").click();
		check("Pause stops the timeline", !(await stateOf(page)).playing);

		await page.locator(".map-2d .res[aria-label^=\"Oroville\"]").click({ force: true });
		await page.waitForTimeout(300);
		check("2D click opens the detail card", await page.locator(".detail-card").isVisible() && /Oroville/.test(await page.locator(".detail-title").innerText()));
		check("Detail card has a storage sparkline", (await page.locator(".detail-spark .spark-line").count()) === 1);
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
			const out = await debug3d(page, "c.outflow()");
			const wet = out.filter((o) => o.pct !== null && o.pct > 0.003);
			const bad = wet.filter((o) => !(o.width > 0.3 && o.length > 3));
			check(`${month}: every dam with water has a visible outflow`, wet.length > 30 && bad.length === 0, `${wet.length} dams, min width ${Math.min(...wet.map((o) => o.width)).toFixed(2)}${bad.length ? `, missing: ${bad.map((o) => o.id).join(",")}` : ""}`);
			const wrong = out.filter((o) => (o.spill > 0.05) !== (o.pct !== null && o.pct > 0.9));
			check(`${month}: spillway cascade only above 90% full`, wrong.length === 0, `${out.filter((o) => o.spill > 0.05).map((o) => o.id).join(",") || "none spilling"}${wrong.length ? `; wrong: ${wrong.map((o) => `${o.id}@${(o.pct * 100).toFixed(0)}%`).join(",")}` : ""}`);
		}

		// Water on the ground: strips sit on the terrain and never run uphill.
		const water = await debug3d(page, "c.verifyWater()");
		check("Rivers and outflows lie on the terrain", water.maxGap < 0.35, `max gap ${water.maxGap} (${water.worst}), ${water.strips} strips`);
		check("Rivers and outflows only run downhill", water.maxClimb <= 0.46, `max climb ${water.maxClimb}`);
		const longOut = await debug3d(page, "c.outflow().filter((o) => o.length >= 8).length");
		check("Most outflows run well downstream", longOut >= 28, `${longOut} of 36 longer than 8 units`);

		// Gauge links are data: hidden by default, shown for a selection or with the toggle.
		await setState(page, { selected: null });
		await page.mouse.move(box.x + 5, box.y + 5);
		await page.waitForTimeout(400);
		check("No gauge links visible by default", (await debug3d(page, "c.linksVisible()")) === 0);
		await page.locator(".js-links").click();
		await page.waitForTimeout(300);
		check("Gauge links toggle shows all links", (await debug3d(page, "c.linksVisible()")) === 54);
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
		await shot(page, "3d-compare.png", ".stage");
		await page.locator(".js-compare").click();

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

		// ---------- iPhone 12 ----------
		for (const scheme of [ "light", "dark" ]) {
			for (const mode of [ "2d", "3d" ]) {
				({ ctx, page, errors } = await openPage(browser, base, { phone: true, scheme, query: `?mode=${mode}` }));
				if (mode === "3d") await waitStill(page, 1500);
				else await page.waitForTimeout(400);
				check(`iPhone 12 ${mode} ${scheme}: no horizontal scroll`, await noHScroll(page));
				if (mode === "3d" && scheme === "light") {
					check("iPhone 12 defaults to low quality", (await page.locator(".js-quality").inputValue()) === "low");
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
