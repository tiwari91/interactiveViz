// Zoom menu in the map dock: shows the current zoom (a multiple of the whole-state view) and
// offers a few presets. Each view supplies its own levels and does the zooming.
export const fmtZoom = (k) => `${k < 9.95 ? k.toFixed(1) : Math.round(k)}×`;

export function createZoomMenu(el, views, store) {
	el.innerHTML = `
		<button type="button" class="stage-btn zoom-btn" aria-haspopup="true" aria-expanded="false">
			<span class="zoom-val num">1.0×</span><svg class="zoom-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>
		</button>
		<ul class="zoom-list" role="menu" hidden></ul>`;
	const btn = el.querySelector(".zoom-btn");
	const val = el.querySelector(".zoom-val");
	const list = el.querySelector(".zoom-list");
	let view = null;
	let current = 1;

	const items = () => [ ...list.querySelectorAll("[role=menuitem]") ];
	function show(k) {
		current = k;
		val.textContent = fmtZoom(k);
		btn.setAttribute("aria-label", `Zoom ${fmtZoom(k)}. Choose a zoom level`);
		// The preset nearest the current zoom (on a log scale) is marked as the current one.
		const levels = view ? view.zoomLevels : [];
		let best = -1;
		levels.forEach((l, i) => {
			if (best < 0 || Math.abs(Math.log(l.k / k)) < Math.abs(Math.log(levels[best].k / k))) best = i;
		});
		items().forEach((b, i) => b.setAttribute("aria-current", String(i === best && Math.abs(Math.log(levels[i].k / k)) < 0.15)));
	}
	function close(focusBtn = false) {
		list.hidden = true;
		btn.setAttribute("aria-expanded", "false");
		if (focusBtn) btn.focus();
	}
	function open() {
		list.hidden = false;
		btn.setAttribute("aria-expanded", "true");
		(items().find((b) => b.getAttribute("aria-current") === "true") || items()[0])?.focus();
	}
	function bind(mode) {
		view?.onZoom(null);
		view = views[mode];
		list.innerHTML = view.zoomLevels.map((l) => `<li role="none"><button type="button" role="menuitem" data-k="${l.k}"><span>${l.name}</span><span class="num">${fmtZoom(l.k)}</span></button></li>`).join("");
		view.onZoom(show);
		show(view.zoomLevel());
	}

	btn.addEventListener("click", () => (list.hidden ? open() : close()));
	list.addEventListener("click", (e) => {
		const b = e.target.closest("[role=menuitem]");
		if (!b) return;
		view.setZoom(+b.dataset.k);
		close(true);
	});
	list.addEventListener("keydown", (e) => {
		const all = items();
		const i = all.indexOf(document.activeElement);
		if (e.key === "Escape") close(true);
		else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length].focus();
		}
	});
	document.addEventListener("pointerdown", (e) => {
		if (!list.hidden && !el.contains(e.target)) close();
	});
	el.addEventListener("focusout", (e) => {
		if (!list.hidden && !el.contains(e.relatedTarget)) close();
	});

	bind(store.get().mode);
	store.subscribe((s, changed) => changed.includes("mode") && bind(s.mode));
	return { current: () => current };
}
