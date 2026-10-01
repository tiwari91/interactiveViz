// 2D view: D3 v7 map with reservoir glyphs and animated stream links.
import { pctAt, flowAt } from "./data.js";
import { colorFor, makeProjection, meander, flowScale, MAJOR_CAPACITY, fmtPct } from "./scales.js";

const d3 = window.d3;
const LABEL_LEFT = new Set([ "CLE", "BER", "WHI" ]);

export function createMap2D(container, data, store, tooltip, audio) {
	const stage = container.parentElement;
	const svg = d3.select(container).append("svg").attr("class", "map-2d")
		.attr("role", "img").attr("aria-label", "Map of California reservoirs coloured by percent full");
	const world = svg.append("g");
	const gCounties = world.append("g");
	const outline = world.append("path").attr("class", "outline");
	const gStreams = world.append("g");
	const gGauges = svg.append("g");
	const gRes = svg.append("g").attr("role", "list");
	const gLabels = svg.append("g").attr("aria-hidden", "true");

	const reservoirs = [ ...data.reservoirs ].sort((a, b) => b.capacity - a.capacity);
	const majors = reservoirs.filter((r) => r.capacity >= MAJOR_CAPACITY);
	let projection;
	let transform = d3.zoomIdentity;
	let rCap = d3.scaleSqrt().domain([ 0, d3.max(reservoirs, (r) => r.capacity) ]);
	let pos = new Map();
	let size = { w: 0, h: 0 };

	gCounties.selectAll("path").data(data.counties.features).join("path")
		.attr("class", "county").append("title").text((d) => d.properties.fullName);

	const streams = gStreams.selectAll("g").data(data.links, (d) => d.key).join("g");
	const streamBase = streams.append("path").attr("class", "stream-base");
	const streamFlow = streams.append("path").attr("class", (d) => `stream-flow${d.gauge.flow ? "" : " no-flow"}`);

	const gauges = gGauges.selectAll("rect").data(data.gauges, (d) => d.id).join("rect")
		.attr("class", "gauge").attr("width", 7).attr("height", 7).attr("rx", 1)
		.on("pointerenter pointermove", (event, g) => {
			const [ x, y ] = d3.pointer(event, stage);
			tooltip.showGauge(g, store.get().dateIndex, data.dates[store.get().dateIndex], x, y);
		})
		.on("pointerleave", () => tooltip.hide());

	const res = gRes.selectAll("g").data(reservoirs, (d) => d.id).join("g")
		.attr("class", (d) => `res${d.hasData ? "" : " no-data"}`)
		.attr("role", "listitem")
		.attr("tabindex", 0);
	res.append("circle").attr("class", "res-cap");
	res.append("circle").attr("class", "res-fill");

	const labels = gLabels.selectAll("text").data(majors, (d) => d.id).join("text").attr("class", "label")
		.attr("text-anchor", (d) => (LABEL_LEFT.has(d.id) ? "end" : "start"))
		.attr("dy", "0.35em")
		.text((d) => d.name.replace(/ \(.*\)$/, "").replace(/ (Dam|Reservoir)$/, ""));

	function showFor(r, x, y) {
		const i = store.get().dateIndex;
		tooltip.showReservoir(r, i, data.dates[i], x, y);
	}

	res
		.on("pointerenter", (event) => {
			if (event.pointerType !== "touch") audio.hover();
		})
		.on("pointerenter.tip pointermove", (event, r) => {
			if (event.pointerType === "touch") return;
			const [ x, y ] = d3.pointer(event, stage);
			showFor(r, x, y);
		})
		.on("pointerleave", (event) => {
			if (event.pointerType !== "touch" && !store.get().selected) tooltip.hide();
		})
		.on("click", (event, r) => {
			event.stopPropagation();
			tooltip.hide();
			store.set({ selected: r.id });
		})
		.on("focus", (event, r) => {
			const p = screenPos(r.id);
			showFor(r, p[0], p[1]);
		})
		.on("blur", () => tooltip.hide())
		.on("keydown", (event, r) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				store.set({ selected: r.id });
			}
		});

	svg.on("click", () => {
		store.set({ selected: null });
		tooltip.hide();
	});

	const zoom = d3.zoom().scaleExtent([ 1, 8 ]).on("zoom", (event) => {
		transform = event.transform;
		world.attr("transform", transform);
		tooltip.hide();
		placeMarks();
	});
	svg.call(zoom).on("dblclick.zoom", null);

	function screenPos(id) {
		const p = pos.get(id);
		return p ? [ transform.applyX(p[0]), transform.applyY(p[1]) ] : [ 0, 0 ];
	}

	function layout() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (!w || !h || (w === size.w && h === size.h)) return;
		size = { w, h };
		svg.attr("viewBox", `0 0 ${w} ${h}`);
		projection = makeProjection(data.outline, w, h, Math.min(28, w * 0.05));
		const path = d3.geoPath(projection);
		gCounties.selectAll("path").attr("d", path);
		outline.attr("d", path(data.outline));
		pos = new Map(data.reservoirs.map((r) => [ r.id, projection([ r.lon, r.lat ]) ]));
		const gpos = new Map(data.gauges.map((g) => [ g.id, projection([ g.lon, g.lat ]) ]));
		const line = d3.line().curve(d3.curveBasis);
		const pathFor = (d) => line(meander(d.key, gpos.get(d.gauge.id), pos.get(d.reservoir.id)));
		streamBase.attr("d", pathFor);
		streamFlow.attr("d", pathFor);
		gauges.each(function (g) {
			this.__pos = gpos.get(g.id);
		});
		rCap = rCap.range([ 0, Math.max(14, Math.min(w, h) * 0.034) ]);
		placeMarks();
		update(store.get());
	}

	function placeMarks() {
		const k = transform.k;
		const grow = Math.sqrt(k); // glyphs grow a little as you zoom in
		res.attr("transform", (r) => {
			const [ x, y ] = screenPos(r.id);
			return `translate(${x},${y})`;
		});
		res.select(".res-cap").attr("r", (r) => Math.max(3, rCap(r.capacity) * grow));
		gauges.attr("x", function () {
			return transform.applyX(this.__pos[0]) - 3.5;
		}).attr("y", function () {
			return transform.applyY(this.__pos[1]) - 3.5;
		});
		// Largest first; flip a label that would leave the stage, hide one that would overlap.
		const placed = [];
		labels.each(function (r) {
			const [ x, y ] = screenPos(r.id);
			const off = Math.max(3, rCap(r.capacity) * grow) + 4;
			const w = this.__w || (this.__w = this.getComputedTextLength());
			let left = LABEL_LEFT.has(r.id);
			if (left && x - off - w < 4) left = false;
			else if (!left && x + off + w > size.w - 4) left = true;
			const x0 = left ? x - off - w : x + off;
			const box = [ x0 - 2, y - 8, x0 + w + 2, y + 8 ];
			const clash = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
			if (!clash) placed.push(box);
			d3.select(this).attr("text-anchor", left ? "end" : "start")
				.attr("display", clash ? "none" : null)
				.attr("transform", `translate(${left ? x - off : x + off},${y})`);
		});
		update(store.get());
	}

	function update({ dateIndex, selected }) {
		const grow = Math.sqrt(transform.k);
		res.classed("active", (r) => r.id === selected)
			.attr("aria-label", (r) => `${r.name}: ${fmtPct(pctAt(r, dateIndex))} full`);
		res.select(".res-fill")
			.attr("r", (r) => {
				const pct = pctAt(r, dateIndex);
				return pct === null ? 0 : Math.max(1.5, rCap(r.capacity) * grow * Math.sqrt(Math.min(1, pct)));
			})
			.attr("fill", (r) => colorFor(pctAt(r, dateIndex)));
		const width = (d) => {
			const f = flowAt(d.gauge, dateIndex);
			return d.gauge.flow ? 0.8 + 5 * flowScale(f ?? 0) : 1.2;
		};
		streamBase.attr("stroke-width", (d) => width(d) + 2);
		streamFlow.attr("stroke-width", width);
	}

	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex") || changed.includes("selected")) update(s);
	});

	new ResizeObserver(layout).observe(container);

	return {
		mount() {
			layout();
		},
		resetView() {
			svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
		},
		screenPos,
		focusReservoir() {},
		pause() {},
		resume() {},
		hint: "Scroll or pinch to zoom, drag to pan. Hover or tap a reservoir.",
	};
}
