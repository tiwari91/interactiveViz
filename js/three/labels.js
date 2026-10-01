// HTML labels for reservoirs: a % full dot always, the name fading in with
// distance (bigger reservoirs stay readable from further away), no overlaps.
import { colorFor, fmtPct } from "../scales.js";

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
				const v = it.b.r.series[dateIndex];
				const p = v === null ? null : v / it.b.r.capacity;
				it.dot.style.background = colorFor(p);
				it.pct.textContent = fmtPct(p);
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
				let alpha = isActive ? 1 : 1 - Math.min(1, Math.max(0, (dist - it.far * 0.75) / (it.far * 0.35)));
				if (!it.w) it.w = it.text.offsetWidth + 16;
				const box = [ x - 6, y - 10, x + it.w, y + 10 ];
				if (alpha > 0.05 && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) alpha = isActive ? 1 : 0;
				if (alpha > 0.05) placed.push(box);
				it.el.style.display = "";
				it.el.classList.toggle("active", isActive);
				it.text.style.opacity = alpha.toFixed(2);
				it.el.style.transform = `translate(${Math.round(x - 5)}px, ${Math.round(y - 9)}px)`;
			}
		},
	};
}
