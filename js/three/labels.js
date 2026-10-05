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
		return { b, el, dot: el.querySelector(".lbl-dot"), pct: el.querySelector(".lbl-pct"), text: el.querySelector(".lbl-text"), far: 220 + 1700 * k * k + 500 * k, w: 0 };
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
			}
		},
		update(camera, width, height, active, hidden) {
			layer.style.display = hidden ? "none" : "";
			if (hidden) return;
			const placed = [];
			for (const it of items) {
				v.set(it.b.cx, it.b.P + 2.2, it.b.cz);
				const dist = v.distanceTo(camera.position);
				v.project(camera);
				if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
					it.el.style.display = "none";
					continue;
				}
				const x = (v.x + 1) / 2 * width;
				const y = (1 - v.y) / 2 * height;
				const isActive = it.b.r.id === active;
				const fade = isActive ? 1 : 1 - Math.min(1, Math.max(0, (dist - it.far * 0.75) / (it.far * 0.35)));
				if (!it.w) it.w = it.text.offsetWidth + 16;
				const box = [ x - 6, y - 10, x + it.w, y + 10 ];
				let show = fade >= SHOW_AT;
				if (show && !isActive && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) show = false;
				if (show) placed.push(box);
				it.el.style.display = "";
				it.el.classList.toggle("active", isActive);
				it.text.classList.toggle("far", !show);
				const t = (fade - SHOW_AT) / (1 - SHOW_AT);
				it.text.style.setProperty("--plate", (PLATE_FAR + (PLATE_NEAR - PLATE_FAR) * Math.max(0, t)).toFixed(2));
				it.el.style.transform = `translate(${Math.round(x - 5)}px, ${Math.round(y - 9)}px)`;
			}
		},
	};
}
