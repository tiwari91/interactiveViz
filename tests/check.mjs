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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml", ".png": "image/png" };

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

async function openPage(browser, base, { phone = false, scheme = "light", query = "" } = {}) {
	const ctx = await browser.newContext({ ...(phone ? devices["iPhone 12"] : { viewport: { width: 1440, height: 1000 } }), colorScheme: scheme });
	const page = await ctx.newPage();
	const errors = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${base}/${query}`);
	await page.waitForSelector("body[data-ready=true]", { timeout: 30000 });
	return { ctx, page, errors };
}

const stateOf = (page) => page.evaluate(() => window.droughtViz.store.get());
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function main() {
	fs.mkdirSync(SHOTS, { recursive: true });
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await chromium.launch({
		executablePath: process.env.CHROME_BIN || undefined,
		args: [ "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist" ],
	});
	const allErrors = [];

	try {
		// Desktop, light, 2D
		let { ctx, page, errors } = await openPage(browser, base);
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

		const shasta = page.locator(".map-2d .res").first(); // sorted by capacity: Shasta
		await shasta.hover();
		const tip2d = await page.locator("#tooltip").innerText();
		check("2D hover shows tooltip", await page.locator("#tooltip").isVisible() && /Shasta/.test(tip2d), tip2d.split("\n")[0]);
		await page.screenshot({ path: path.join(SHOTS, "desktop-2d-tooltip.png") });
		await page.mouse.move(5, 5);

		const before = await page.locator(".js-state-pct").innerText();
		const slider = page.locator(".timeline input[type=range]");
		await slider.focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
		const after = await page.locator(".js-state-pct").innerText();
		const fillAfter = await page.evaluate(() => document.querySelector(".map-2d .res-fill").getAttribute("r"));
		check("Timeline scrub changes statewide value", before !== after, `${before} -> ${after}`);
		check("Timeline scrub updates month label", /2016/.test(await page.locator(".date-readout .month").innerText()), await page.locator(".date-readout .month").innerText());
		check("Timeline scrub updates 2D glyphs", Boolean(fillAfter));

		await page.locator(".play-btn").click();
		const i0 = (await stateOf(page)).dateIndex;
		await page.waitForTimeout(1300);
		const s1 = await stateOf(page);
		check("Play advances the timeline", s1.playing && s1.dateIndex > i0, `${i0} -> ${s1.dateIndex}`);
		await page.locator(".play-btn").click();
		check("Pause stops the timeline", !(await stateOf(page)).playing);

		await page.evaluate(() => window.droughtViz.store.set({ dateIndex: 35 }));
		await page.screenshot({ path: path.join(SHOTS, "desktop-2d-light.png"), fullPage: true });

		await page.locator("#theme-toggle").click();
		check("Theme toggle switches to dark", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
		await page.waitForTimeout(300);
		await page.screenshot({ path: path.join(SHOTS, "desktop-2d-dark.png"), fullPage: true });

		// Switch to 3D in the same page; the timeline state is shared.
		await page.locator(".mode-switch button[data-mode=\"3d\"]").click();
		await page.waitForFunction(() => document.body.dataset.mode === "3d", null, { timeout: 30000 });
		await page.waitForTimeout(2200);
		const gl = await page.evaluate(() => {
			const c = window.droughtViz.views["3d"].debug();
			const canvas = document.querySelector("#view-3d canvas");
			return { triangles: c.renderer.info.render.triangles, calls: c.renderer.info.render.calls, w: canvas.width, h: canvas.height, ctx: Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")) };
		});
		check("3D WebGL canvas renders", gl.ctx && gl.triangles > 1000 && gl.w > 0, `${gl.triangles} tris, ${gl.calls} draw calls, ${gl.w}x${gl.h}`);
		check("3D keeps the shared month", (await stateOf(page)).dateIndex === 35);

		const lvl0 = await page.evaluate(() => window.droughtViz.views["3d"].debug().waterLevel("SHA"));
		await page.evaluate(() => window.droughtViz.store.set({ dateIndex: 66 }));
		await page.waitForTimeout(1200);
		const lvl1 = await page.evaluate(() => window.droughtViz.views["3d"].debug().waterLevel("SHA"));
		check("Timeline changes 3D water level", Math.abs(lvl1 - lvl0) > 5, `Shasta ${lvl0.toFixed(1)} -> ${lvl1.toFixed(1)}`);

		const box = await page.locator("#view-3d").boundingBox();
		const [ sx, sy ] = await page.evaluate(() => window.droughtViz.views["3d"].screenPos("SHA"));
		await page.mouse.move(box.x + sx, box.y + sy + 40);
		await page.waitForTimeout(250);
		const tip3d = await page.locator("#tooltip").innerText().catch(() => "");
		check("3D raycast hover shows tooltip", await page.locator("#tooltip").isVisible() && /Shasta/.test(tip3d), tip3d.split("\n")[0]);
		await page.screenshot({ path: path.join(SHOTS, "desktop-3d-tooltip.png") });
		await page.mouse.move(box.x + 5, box.y + 5);

		// Frame time with the scene animating.
		const frame = await page.evaluate(() => new Promise((resolve) => {
			const t = [];
			let last = performance.now();
			const step = (now) => {
				t.push(now - last);
				last = now;
				if (t.length < 60) requestAnimationFrame(step);
				else resolve(t.slice(5).sort((a, b) => a - b)[Math.floor(t.length / 2)]);
			};
			requestAnimationFrame(step);
		}));
		check("3D median frame interval measured", frame > 0, `${frame.toFixed(1)} ms (software GL)`);

		await page.evaluate(() => window.droughtViz.store.set({ dateIndex: 35 }));
		await page.waitForTimeout(1200);
		await page.screenshot({ path: path.join(SHOTS, "desktop-3d-dark.png"), fullPage: true });
		await page.locator("#theme-toggle").click();
		await page.waitForTimeout(500);
		await page.screenshot({ path: path.join(SHOTS, "desktop-3d-light.png"), fullPage: true });
		allErrors.push(...errors);
		await ctx.close();

		// iPhone 12, both themes and modes.
		for (const scheme of [ "light", "dark" ]) {
			for (const mode of [ "2d", "3d" ]) {
				({ ctx, page, errors } = await openPage(browser, base, { phone: true, scheme, query: mode === "3d" ? "?mode=3d" : "" }));
				await page.waitForTimeout(mode === "3d" ? 2200 : 400);
				check(`iPhone 12 ${mode} ${scheme}: no horizontal scroll`, await noHScroll(page));
				if (mode === "3d" && scheme === "light") {
					const [ x, y ] = await page.evaluate(() => window.droughtViz.views["3d"].screenPos("ORO"));
					await page.locator("#view-3d").scrollIntoViewIfNeeded();
					const b2 = await page.locator("#view-3d").boundingBox();
					await page.touchscreen.tap(b2.x + x, b2.y + y + 30);
					await page.waitForTimeout(300);
					const tip = await page.locator("#tooltip").innerText().catch(() => "");
					check("iPhone 12 3D tap shows tooltip", await page.locator("#tooltip").isVisible() && tip.length > 0, tip.split("\n")[0]);
					await page.locator(".viz-card").screenshot({ path: path.join(SHOTS, "iphone12-3d-tap.png") });
				}
				if (mode === "2d" && scheme === "light") {
					const res = page.locator(".map-2d .res[aria-label^=\"Pine Flat\"]");
					await res.scrollIntoViewIfNeeded();
					await res.tap();
					await page.waitForTimeout(200);
					check("iPhone 12 2D tap shows tooltip", await page.locator("#tooltip").isVisible());
					await page.mouse.click(2, 2);
				}
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({ path: path.join(SHOTS, `iphone12-${mode}-${scheme}.png`), fullPage: true });
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
