// HTML labels for reservoirs: a % full dot always, the name shown with distance
// (bigger reservoirs stay readable from further away), no overlaps.
// The text itself never fades: a faded label would drop below AA contrast over
// bright terrain. Distance fades only the label's backing plate (which stays dark
// enough for AA), and a label that is too far away is hidden, leaving its dot.
import { markColor, fmtPct } from "../scales.js";

const SHOW_AT = 0.5; // distance fade below which the name is hidden
const PLATE_NEAR = 0.88; // plate opacity close up
const PLATE_FAR = 0.74; // plate opacity at the edge of the range; still >= 4.5:1 over white

export function createLabels(THREE, container, basins, maxCap) {
	const v = new THREE.Vector3();
	const layer = document.createElement("div");
	layer.className = "labels-3d";
	layer.setAttribute("aria-hidden", "true");
	container.appendChild(layer);
	const items = [ ...basins.basins ].sort((a, b) => b.r.capacity - a.r.capacity).map((b) => {
		const el = document.createElement("div");
		el.className = "lbl";
		el.innerHTML = "<span class=\"lbl-dot\"></span><span class=\"lbl-text\"><span class=\"lbl-name\"></span> <span class=\"lbl-pct\"></span></span>";
		el.querySelector(".lbl-name").textContent = b.r.name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir)$/, "");
		layer.appendChild(el);
		const k = Math.sqrt(b.r.capacity / maxCap);
		return { b, el, dot: el.querySelector(".lbl-dot"), pct: el.querySelector(".lbl-pct"), text: el.querySelector(".lbl-text"), far: 600 + 2200 * k, w: 0 };
	});

	return {
		layer,
		setValues(dateIndex) {
			for (const it of items) {
				const r = it.b.r;
				const v = r.series[dateIndex];
				const p = v === null ? null : v / r.capacity;
				const c = markColor(r, p);
				it.dot.style.background = c ?? "";
				it.dot.classList.toggle("no-data", c === null);
				it.dot.classList.toggle("flood", r.floodControl);
				it.pct.textContent = p === null ? "no data" : r.floodControl ? `${fmtPct(p)} · flood control` : fmtPct(p);
				it.w = 0; // the text width changes with the value; measure again when next shown
			}
		},
		// reach: how much further than the wide desktop view the home view sits (a portrait
		// phone frames the state from further out), so names show over the same part of it.
		// clip: [x0, x1, y0, y1] screen box this layer covers (one half of the compare split), or
		// null; avoid: [x0, y0, x1, y1] boxes names must keep clear of (e.g. the compare chips).
		update(camera, width, height, active, hidden, target = null, groundAt = null, reachScale = 1, clip = null, avoid = []) {
			layer.style.display = hidden ? "none" : "";
			if (hidden) return;
			layer.style.clipPath = clip ? `inset(${clip[2]}px ${Math.max(0, width - clip[1])}px ${Math.max(0, height - clip[3])}px ${clip[0]}px)` : "";
			const placed = [ ...avoid ];
			const cam = camera.position;
			// Flown in close: lakes far beyond the one in view would float along the horizon.
			const near = target ? cam.distanceTo(target) : Infinity;
			const reach = near < 400 ? near * 4 + 80 : Infinity;
			for (const it of items) {
				v.set(it.b.cx, it.b.P + 2.2, it.b.cz);
				const dist = v.distanceTo(cam);
				const isActive0 = it.b.r.id === active;
				let hide = !isActive0 && dist > reach;
				// Hidden behind a ridge: the ground rises above the sight line somewhere along it.
				if (!hide && !isActive0 && groundAt) {
					for (const f of [ 0.2, 0.4, 0.6, 0.8 ]) {
						const x = cam.x + (v.x - cam.x) * f;
						const z = cam.z + (v.z - cam.z) * f;
						if (groundAt(x, z) > cam.y + (v.y - cam.y) * f + 0.5) {
							hide = true;
							break;
						}
					}
				}
				v.project(camera);
				if (hide || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
					it.el.style.display = "none";
					continue;
				}
				const x = (v.x + 1) / 2 * width;
				const y = (1 - v.y) / 2 * height;
				if (clip && (x < clip[0] || x > clip[1] || y < clip[2] || y > clip[3])) {
					it.el.style.display = "none";
					continue;
				}
				const isActive = it.b.r.id === active;
				const far = it.far * reachScale;
				const fade = isActive ? 1 : 1 - Math.min(1, Math.max(0, (dist - far * 0.75) / (far * 0.35)));
				if (!it.w) {
					// Measure while displayed: a hidden label has no width.
					it.el.style.display = "";
					it.w = it.text.offsetWidth + 16;
				}
				// The name goes right of its dot, or left of it when that side is taken or off screen.
				const right = [ x - 6, y - 10, x + it.w, y + 10 ];
				const left = [ x - it.w, y - 10, x + 6, y + 10 ];
				const free = (b) => b[0] >= (clip ? clip[0] : 0) && b[2] <= (clip ? clip[1] : width) && (!clip || (b[1] >= clip[2] && b[3] <= clip[3])) && !placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
				// Flood-control basins (empty by design) are named only well within range, so the
				// state view spends its room on storage reservoirs; they keep their striped dot.
				let show = fade >= (it.b.r.floodControl ? 1 : SHOW_AT);
				let onLeft = false;
				if (show && !isActive && !free(right)) {
					if (free(left)) onLeft = true;
					else show = false;
				}
				if (show) placed.push(onLeft ? left : right);
				it.el.style.display = "";
				it.el.classList.toggle("active", isActive);
				it.el.classList.toggle("left", onLeft);
				// Named labels sit above bare dots, so a neighbour's dot never cuts through a name.
				it.el.style.zIndex = isActive ? 3 : show ? 2 : 1;
				it.text.classList.toggle("far", !show);
				const t = (fade - SHOW_AT) / (1 - SHOW_AT);
				it.text.style.setProperty("--plate", (PLATE_FAR + (PLATE_NEAR - PLATE_FAR) * Math.max(0, t)).toFixed(2));
				// A left-flipped label is anchored by its right edge, so the dot stays on the lake
				// whatever the width of the text.
				it.el.style.transform = onLeft ? `translate(${Math.round(x + 5)}px, ${Math.round(y - 9)}px) translateX(-100%)` : `translate(${Math.round(x - 5)}px, ${Math.round(y - 9)}px)`;
			}
		},
	};
}
