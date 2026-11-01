// Projection mode: only the map, on black, for projecting onto a cut-out California
// (as at CHI 2017). Keys line the image up with the physical shape; the fit is remembered.
//   Arrows nudge (Shift = 10x), + / - scale, < / > rotate, PageUp / PageDown step the month,
//   Space plays, 0 resets the fit, H hides the help, Esc leaves.
const KEY = "cdi-projection";
const BASE = { x: 0, y: 0, s: 1, r: 0 };

function load() {
	try {
		return { ...BASE, ...JSON.parse(localStorage.getItem(KEY)) };
	} catch (e) {
		return { ...BASE };
	}
}

export function createProjection(button, stage, store, data) {
	let fit = load();
	let on = false;
	const help = document.createElement("div");
	help.className = "pj-help";
	help.innerHTML = `<p><strong>Projection mode</strong></p>
		<p>Arrows move · Shift + arrows move more · + / − size · &lt; / &gt; turn</p>
		<p>PageUp / PageDown month · Space play · 0 reset fit · H hide this · Esc leave</p>`;
	const month = document.createElement("p");
	month.className = "pj-month num";
	stage.append(help, month);

	const apply = () => {
		stage.style.setProperty("--pj-x", `${fit.x}px`);
		stage.style.setProperty("--pj-y", `${fit.y}px`);
		stage.style.setProperty("--pj-s", String(fit.s));
		stage.style.setProperty("--pj-r", `${fit.r}deg`);
		try {
			localStorage.setItem(KEY, JSON.stringify(fit));
		} catch (e) { /* storage unavailable */ }
	};
	const showMonth = () => {
		month.textContent = data.months[store.get().dateIndex];
	};

	function onKey(e) {
		if (!on) return;
		const big = e.shiftKey ? 10 : 1;
		const moves = { ArrowLeft: [ -2, 0 ], ArrowRight: [ 2, 0 ], ArrowUp: [ 0, -2 ], ArrowDown: [ 0, 2 ] };
		let handled = true;
		if (moves[e.key]) {
			fit.x += moves[e.key][0] * big;
			fit.y += moves[e.key][1] * big;
		} else if (e.key === "+" || e.key === "=") fit.s *= 1.01 ** big;
		else if (e.key === "-" || e.key === "_") fit.s /= 1.01 ** big;
		else if (e.key === "<" || e.key === ",") fit.r -= 0.25 * big;
		else if (e.key === ">" || e.key === ".") fit.r += 0.25 * big;
		else if (e.key === "0") fit = { ...BASE };
		else if (e.key === "h" || e.key === "H") help.hidden = !help.hidden;
		else if (e.key === "PageUp" || e.key === "PageDown") {
			const i = store.get().dateIndex + (e.key === "PageUp" ? 1 : -1);
			store.set({ dateIndex: Math.max(0, Math.min(data.months.length - 1, i)), playing: false });
		} else if (e.key === "Escape") exit();
		else handled = false;
		if (handled) {
			e.preventDefault();
			e.stopImmediatePropagation();
			apply();
		}
	}

	function enter() {
		on = true;
		help.hidden = false;
		document.body.classList.add("projecting");
		button.setAttribute("aria-pressed", "true");
		apply();
		showMonth();
		document.documentElement.requestFullscreen?.().catch(() => {});
		window.dispatchEvent(new Event("resize"));
	}
	function exit() {
		if (!on) return;
		on = false;
		document.body.classList.remove("projecting");
		button.setAttribute("aria-pressed", "false");
		if (document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
		window.dispatchEvent(new Event("resize"));
		button.focus();
	}

	button.addEventListener("click", () => (on ? exit() : enter()));
	window.addEventListener("keydown", onKey, true);
	document.addEventListener("fullscreenchange", () => {
		if (on && !document.fullscreenElement) exit();
	});
	store.subscribe((s, changed) => changed.includes("dateIndex") && showMonth());
	return { enter, exit, get on() { return on; }, get fit() { return { ...fit }; } };
}
