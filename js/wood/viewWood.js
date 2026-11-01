// Wood view: the map as stacked laser-cut birch with a walnut inlay where reservoirs are low,
// after Yoon Chung Han's wooden sculptures for California Drought Impact (2016).
// A strip of six small pieces (one September per year) recreates her row of sculptures.
import { pctAt, ofAvgAt } from "../data.js";
import { makeProjection, fmtPct, fmtMonth } from "../scales.js";
import { createWoodField, pathOf, areaShare, DRY_BELOW, DEEP_BELOW } from "./field.js";
import { cutFileSVG, download } from "./cutfile.js";
import { moveTarget } from "../roving.js";

const d3 = window.d3;
const HER_PAGE = "http://yoonchunghan.com/portfolio/california-drought-impact.html";
// One piece per water year, end of September, like her row of six.
export const PIECE_MONTHS = [ "2012-09", "2013-09", "2014-09", "2015-09", "2016-09", "2017-09" ];

const FILTERS = `
	<filter id="wood-birch" x="-4%" y="-4%" width="110%" height="110%" color-interpolation-filters="sRGB">
		<feTurbulence type="fractalNoise" baseFrequency="0.16 0.011" numOctaves="2" seed="7" result="n"/>
		<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.40  0 0 0 0 0.24  0.9 0 0 0 -0.38" result="grain"/>
		<feComposite in="grain" in2="SourceGraphic" operator="in" result="g"/>
		<feMerge result="wood"><feMergeNode in="SourceGraphic"/><feMergeNode in="g"/></feMerge>
		<feDropShadow in="wood" dx="1.3" dy="2" stdDeviation="1.6" flood-color="#2b1d10" flood-opacity="0.42"/>
	</filter>
	<filter id="wood-walnut" x="-4%" y="-4%" width="110%" height="110%" color-interpolation-filters="sRGB">
		<feTurbulence type="fractalNoise" baseFrequency="0.13 0.009" numOctaves="3" seed="11" result="n"/>
		<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.10  0 0 0 0 0.06  0 0 0 0 0.03  1.3 0 0 0 -0.45" result="dark"/>
		<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.38  0 0 0 0 0.24  0 0 -1.4 0 0.62" result="light"/>
		<feMerge result="m"><feMergeNode in="SourceGraphic"/><feMergeNode in="light"/><feMergeNode in="dark"/></feMerge>
		<feComposite in="m" in2="SourceGraphic" operator="in"/>
	</filter>
	<filter id="wood-small" x="-6%" y="-6%" width="115%" height="115%">
		<feDropShadow dx="0.8" dy="1.2" stdDeviation="0.9" flood-color="#2b1d10" flood-opacity="0.4"/>
	</filter>`;

export function createWood(container, data, store, tooltip) {
	const stage = container.parentElement;
	container.innerHTML = `
		<svg class="map-wood" role="group" aria-label="Wood map: walnut where reservoirs are below ${Math.round(DRY_BELOW * 100)}% of their usual level">
			<defs>${FILTERS}</defs>
			<g class="wood-world">
				<g class="wood-layers"></g>
				<path class="wood-dry"></path>
				<path class="wood-deep"></path>
				<g class="wood-res" role="list" aria-label="Reservoirs, largest first. Arrow keys move between them; Enter opens one."></g>
			</g>
		</svg>
		<div class="wood-caption">
			<p class="wood-month num"></p>
			<p class="wood-stat"></p>
			<p class="wood-key"><span><span class="sw sw-birch"></span> Birch: near usual or above</span><span><span class="sw sw-walnut"></span> Walnut: below ${Math.round(DRY_BELOW * 100)}% of usual</span><span><span class="sw sw-deep"></span> Dark walnut: below ${Math.round(DEEP_BELOW * 100)}%</span></p>
			<button type="button" class="stage-btn wood-cut">Download cut file (SVG)</button>
			<p class="wood-credit">After Yoon Chung Han’s laser-cut wood sculptures (2016). <a href="${HER_PAGE}" target="_blank" rel="noopener">Her project page</a>. Between reservoirs the walnut is drawn, not mapped.</p>
		</div>
		<div class="wood-strip" role="group" aria-label="Six pieces, one September per year"></div>`;
	const svg = d3.select(container).select("svg");
	const world = svg.select(".wood-world");
	const gLayers = world.select(".wood-layers");
	const dryPath = world.select(".wood-dry").attr("filter", "url(#wood-walnut)");
	const deepPath = world.select(".wood-deep").attr("filter", "url(#wood-walnut)");
	const gRes = world.select(".wood-res");
	const strip = container.querySelector(".wood-strip");
	const pieceIdx = PIECE_MONTHS.map((m) => data.months.indexOf(m)).filter((i) => i >= 0);

	let field = null;
	let ready = null;
	let proj = null;
	let size = { w: 0, h: 0 };
	let transform = d3.zoomIdentity;
	let zoomListener = null;
	let outlineArea = 0;
	const sites = data.reservoirs.filter((r) => r.hasData).sort((a, b) => b.capacity - a.capacity);
	const rCap = d3.scaleSqrt().domain([ 0, d3.max(sites, (r) => r.capacity) ]);

	// One tab stop for all reservoirs (roving tabindex), as on the 2D map.
	const res = gRes.selectAll("g").data(sites, (r) => r.id).join("g").attr("class", "wres")
		.attr("role", "listitem").attr("tabindex", (d, k) => (k === 0 ? 0 : -1));
	let rover = sites[0]?.id;
	const setRover = (id) => {
		rover = id;
		res.attr("tabindex", (d) => (d.id === id ? 0 : -1));
	};
	const tipAt = (r) => {
		const [ x, y ] = api.screenPos(r.id);
		const i = store.get().dateIndex;
		tooltip.showReservoir(r, i, data.dates[i], x, y);
	};
	res.append("circle").attr("class", "wres-cap");
	res.append("circle").attr("class", "wres-fill");
	res
		.on("pointerenter pointermove", (event, r) => {
			const [ x, y ] = d3.pointer(event, stage);
			const i = store.get().dateIndex;
			tooltip.showReservoir(r, i, data.dates[i], x, y);
		})
		.on("pointerleave", () => !store.get().selected && tooltip.hide())
		.on("click", (event, r) => {
			event.stopPropagation();
			tooltip.hide();
			store.set({ selected: r.id });
		})
		.on("focus", (event, r) => {
			if (rover !== r.id) setRover(r.id);
			tipAt(r);
		})
		.on("blur", () => tooltip.hide())
		.on("keydown", (event, r) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				store.set({ selected: r.id });
				return;
			}
			const next = moveTarget(event.key, sites, (o) => api.screenPos(o.id), r);
			if (!next) return;
			event.preventDefault();
			event.stopPropagation(); // arrows here move between lakes, not through the months
			if (next !== r) {
				setRover(next.id);
				res.filter((d) => d.id === next.id).node().focus();
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
		zoomListener?.(transform.k);
	});
	svg.call(zoom).on("dblclick.zoom", null);

	container.querySelector(".wood-cut").addEventListener("click", () => {
		const i = store.get().dateIndex;
		download(api.cutFile(i), `california-drought-${data.months[i]}.svg`);
	});

	const project = (p) => proj(p);

	function statLine(i) {
		const t = data.totals[i];
		return `Statewide ${fmtPct(t.pct)} full, ${t.ofAvg === null ? "no average" : `${fmtPct(t.ofAvg)} of the usual level`} for the month`;
	}

	function layout() {
		const w = container.clientWidth, h = container.clientHeight;
		if (!field || !w || !h || (w === size.w && h === size.h)) return;
		size = { w, h };
		svg.attr("viewBox", `0 0 ${w} ${h}`);
		proj = makeProjection(data.outline, w, h, Math.min(36, w * 0.06));
		const base = d3.geoPath(proj)(data.outline);
		outlineArea = d3.geoPath(proj).area(data.outline);
		const all = [ { d: base, k: 0 }, ...field.layers.map((l, k) => ({ d: pathOf(l.polys, project), k: k + 1, m: l.metres })) ];
		gLayers.selectAll("path").data(all).join("path")
			.attr("class", (d) => `wood-layer l${d.k}`)
			.attr("d", (d) => d.d)
			.attr("filter", "url(#wood-birch)");
		rCap.range([ 0, Math.max(9, Math.min(w, h) * 0.024) ]);
		res.attr("transform", (r) => `translate(${proj([ r.lon, r.lat ])})`);
		res.select(".wres-cap").attr("r", (r) => Math.max(2.5, rCap(r.capacity)));
		update(store.get());
	}

	function drawPieces() {
		const W = 46, H = 54;
		const p = makeProjection(data.outline, W, H, 3);
		const outline = d3.geoPath(p)(data.outline);
		strip.innerHTML = pieceIdx.map((i) => `
			<button type="button" class="wood-piece" data-index="${i}" aria-label="${fmtMonth(data.dates[i])}: ${statLine(i)}">
				<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
					<path class="wp-base" d="${outline}" filter="url(#wood-small)"/>
					<path class="wp-dry" d="${pathOf(field.dryAt(i), p)}"/>
					<path class="wp-deep" d="${pathOf(field.dryAt(i, DEEP_BELOW), p)}"/>
				</svg>
				<span class="num">${data.months[i].slice(0, 4)}</span>
			</button>`).join("");
		strip.querySelectorAll(".wood-piece").forEach((b) => b.addEventListener("click", () => store.set({ dateIndex: +b.dataset.index, playing: false })));
	}

	function update({ dateIndex: i, selected }) {
		if (!field || !proj) return;
		dryPath.attr("d", pathOf(field.dryAt(i), project));
		deepPath.attr("d", pathOf(field.dryAt(i, DEEP_BELOW), project));
		res.classed("active", (r) => r.id === selected)
			.attr("aria-label", (r) => `${r.name}: ${pctAt(r, i) === null ? "no data" : `${fmtPct(pctAt(r, i))} full`}${(ofAvgAt(data, r, i) ?? 1) < DRY_BELOW ? ", below its usual level" : ""}`);
		if (selected && selected !== rover && sites.some((r) => r.id === selected)) setRover(selected);
		res.select(".wres-fill").attr("r", (r) => {
			const v = pctAt(r, i);
			return v === null ? 0 : Math.max(1, Math.max(2.5, rCap(r.capacity)) * Math.sqrt(Math.min(1, v)));
		});
		res.classed("low", (r) => (ofAvgAt(data, r, i) ?? 1) < DRY_BELOW);
		container.querySelector(".wood-month").textContent = fmtMonth(data.dates[i]);
		container.querySelector(".wood-stat").textContent = statLine(i);
		strip.querySelectorAll(".wood-piece").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.index === i)));
	}

	store.subscribe((s, changed) => {
		if (changed.includes("dateIndex") || changed.includes("selected")) update(s);
	});
	new ResizeObserver(() => layout()).observe(container);

	const api = {
		async mount(progress) {
			if (!ready) {
				progress?.(0.2, "Cutting the wood layers…");
				ready = createWoodField(data).then((f) => {
					field = f;
					drawPieces();
				});
			}
			await ready;
			layout();
			update(store.get());
		},
		resetView() {
			svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
		},
		zoomLevels: [ { name: "State", k: 1 }, { name: "Region", k: 2 }, { name: "Basin", k: 4 } ],
		zoomLevel: () => transform.k,
		setZoom(k) {
			if (k <= 1.001) svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
			else svg.transition().duration(500).call(zoom.scaleTo, k);
		},
		onZoom(fn) {
			zoomListener = fn;
		},
		screenPos(id) {
			const r = data.byId.get(id);
			if (!r || !proj) return [ 0, 0 ];
			const p = proj([ r.lon, r.lat ]);
			return [ transform.applyX(p[0]), transform.applyY(p[1]) ];
		},
		focusReservoir() {},
		pause() {},
		resume() {},
		cutFile(i = store.get().dateIndex) {
			return cutFileSVG(data, field, i, fmtMonth(data.dates[i]), statLine(i));
		},
		// For tests: walnut share of the state's area for a month, and piece months.
		debug() {
			return field && {
				dryShare: (i, below) => areaShare(field.dryAt(i, below), outlineArea, project),
				layers: field.layers.length,
				pieces: pieceIdx.map((i) => data.months[i]),
			};
		},
		hint: "Walnut marks reservoirs below their usual level. Pick a year piece, or scroll to zoom.",
	};
	return api;
}
