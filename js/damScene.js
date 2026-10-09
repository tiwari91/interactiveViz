// Dam-and-lake illustration for the detail card: hills, a valley lake filled to % of capacity,
// the exposed "bathtub ring" above the waterline and a concrete dam with a full-pool mark.
import { pctAt, ofAvgAt } from "./data.js";
import { fmtPct } from "./scales.js";
import { damTypeOf, structureOf } from "./three/damTypes.js";

const d3 = window.d3;
const W = 320;
const H = 116;
const FULL_Y = 40; // full-pool line
const BED_Y = 104; // deepest point of the lake
const DAM_X = 252;
const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Water tone from % of the seasonal average: pale and silty when well below, deep blue at or above.
const tone = d3.scaleLinear().domain([ 0.4, 1.05 ]).range([ 0, 1 ]).clamp(true);
const SURF = d3.interpolateRgb("#b7cfd2", "#4f93c4");
const DEEP = d3.interpolateRgb("#8fb0b4", "#1f5f92");

function hash(s) {
	let h = 7;
	for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h;
}

const rnd = (seed, i) => (((seed + 1) * (i + 11) * 2654435761) >>> 0) / 4294967296;

// A ridge across the card: alternating peaks and saddles, varied per reservoir.
function ridge(seed, base, lo, hi, n) {
	const pts = [];
	for (let i = 0; i <= n; i++) {
		const peak = i % 2 === 1;
		const x = (i / n) * W + (rnd(seed, i) - 0.5) * (W / n) * 0.6;
		pts.push([ Math.max(0, Math.min(W, x)), peak ? base - lo - (hi - lo) * rnd(seed, i + 40) : base - lo * 0.5 * rnd(seed, i + 80) ]);
	}
	return pts;
}

// Valley cross-section: banks rise from the bed to above the full-pool line, closed by the dam.
const BANK = [ [ 0, FULL_Y - 16 ], [ 22, FULL_Y - 6 ], [ 52, FULL_Y + 14 ], [ 96, BED_Y - 24 ], [ 150, BED_Y - 4 ], [ 205, BED_Y ], [ DAM_X, BED_Y - 1 ] ];
const bankPath = d3.line().curve(d3.curveCatmullRom)(BANK);
const basinPath = `${bankPath}L${DAM_X},${FULL_Y - 8}L0,${FULL_Y - 8}Z`;
const groundPath = `${bankPath}L${DAM_X},${H}L0,${H}Z`;

export const waterY = (pct) => BED_Y - (BED_Y - FULL_Y) * Math.max(0, Math.min(1, pct));

export function createDamScene(svgEl) {
	const svg = d3.select(svgEl).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
	const defs = svg.append("defs");
	const gid = `ds${Math.random().toString(36).slice(2, 7)}`;
	const grad = (id, stops, x2 = 0, y2 = 1) => {
		const g = defs.append("linearGradient").attr("id", `${gid}-${id}`).attr("x1", 0).attr("y1", 0).attr("x2", x2).attr("y2", y2);
		stops.forEach(([ o, c ]) => g.append("stop").attr("offset", o).attr("stop-color", c));
		return g;
	};
	grad("sky", [ [ 0, "var(--scene-sky-1)" ], [ 1, "var(--scene-sky-2)" ] ]);
	grad("far", [ [ 0, "var(--scene-far-1)" ], [ 1, "var(--scene-far-2)" ] ]);
	grad("near", [ [ 0, "var(--scene-near-1)" ], [ 1, "var(--scene-near-2)" ] ]);
	grad("dam", [ [ 0, "#d9d6cf" ], [ 0.55, "#b9b5ac" ], [ 1, "#8f8b83" ] ], 1, 0);
	const water = grad("water", [ [ 0, "#4f93c4" ], [ 1, "#1f5f92" ] ]);
	defs.append("clipPath").attr("id", `${gid}-basin`).append("path").attr("d", basinPath);
	const u = (id) => `url(#${gid}-${id})`;

	svg.append("rect").attr("class", "scene-sky").attr("width", W).attr("height", H).attr("rx", 8).attr("fill", u("sky"));
	const far = svg.append("path").attr("class", "scene-far").attr("fill", u("far"));
	const snow = svg.append("path").attr("class", "scene-snow");
	const near = svg.append("path").attr("class", "scene-near").attr("fill", u("near"));
	// Valley: dry earth everywhere the lake could be, then the bathtub ring, then the water.
	svg.append("path").attr("class", "dam-bed").attr("d", groundPath);
	// Bathtub ring: the pale, bleached band of bank between the full-pool line and the water.
	const ringClip = defs.append("clipPath").attr("id", `${gid}-ring`).append("rect").attr("x", 0).attr("width", DAM_X);
	svg.append("path").attr("class", "dam-ring-band").attr("d", bankPath).attr("clip-path", u("ring"));
	const lake = svg.append("g").attr("clip-path", u("basin"));
	const wat = lake.append("rect").attr("class", "dam-water").attr("x", 0).attr("width", DAM_X).attr("height", H).attr("fill", u("water"));
	const surface = lake.append("line").attr("class", "dam-surface").attr("x1", 0).attr("x2", DAM_X);
	const shimmer = lake.append("g").attr("class", "dam-shimmer");
	[ [ 120, 22 ], [ 170, 14 ], [ 205, 26 ] ].forEach(([ x, w ], k) => shimmer.append("line").attr("x1", x).attr("x2", x + w).attr("y1", 4 + k * 3).attr("y2", 4 + k * 3));
	// Downstream: the canyon floor and river below the dam.
	svg.append("path").attr("class", "dam-ground").attr("d", `M${DAM_X},${BED_Y - 1}L${W},${BED_Y + 4}L${W},${H}L${DAM_X},${H}Z`);
	svg.append("path").attr("class", "dam-river").attr("d", `M${DAM_X + 34},${BED_Y + 5}Q${DAM_X + 50},${BED_Y + 7} ${W},${BED_Y + 7}`);
	// Dam wall: a gravity section, steep upstream face, sloped downstream face, crest road on top.
	const crest = FULL_Y - 9;
	const wall = svg.append("path").attr("class", "dam-wall");
	const crestLine = svg.append("line").attr("class", "dam-crest").attr("y1", crest).attr("y2", crest);
	const joints = svg.append("g").attr("class", "dam-joints");
	for (let y = crest + 12; y < BED_Y; y += 12) {
		joints.append("line").attr("class", "dam-joint").attr("x1", DAM_X - 3 + (y - crest) * 0.03).attr("x2", DAM_X + 6 + ((y - crest) / (BED_Y - crest)) ** 1.6 * 30).attr("y1", y).attr("y2", y);
	}
	grad("embank", [ [ 0, "var(--scene-embank-1)" ], [ 1, "var(--scene-embank-2)" ] ], 1, 0);
	// Concrete: steep upstream face, curved downstream face. Embankment: a broad earth or rock wedge.
	const setType = (type) => {
		const concrete = type !== "earthfill" && type !== "rockfill";
		wall.attr("fill", u(concrete ? "dam" : "embank")).classed("embankment", !concrete)
			.attr("d", concrete
				? `M${DAM_X - 3},${crest}L${DAM_X + 4},${crest}L${DAM_X + 7},${crest + 10}Q${DAM_X + 22},${BED_Y - 18} ${DAM_X + 38},${BED_Y + 5}L${DAM_X - 6},${BED_Y + 5}Z`
				: `M${DAM_X - 4},${crest}L${DAM_X + 6},${crest}L${DAM_X + 44},${BED_Y + 5}L${DAM_X - 26},${BED_Y + 5}Z`);
		crestLine.attr("x1", DAM_X - 5).attr("x2", DAM_X + 7);
		joints.attr("display", concrete ? null : "none");
	};
	svg.append("line").attr("class", "dam-fullmark").attr("x1", 30).attr("x2", DAM_X + 9).attr("y1", FULL_Y).attr("y2", FULL_Y);
	svg.append("text").attr("class", "dam-fulltext").attr("x", 34).attr("y", FULL_Y - 3).text("full pool");
	const label = svg.append("text").attr("class", "dam-level").attr("x", 150).attr("text-anchor", "middle");

	let lastId = null;
	return function render(data, r, i) {
		if (r.id !== lastId) {
			const s = hash(r.id);
			const line = d3.line().curve(d3.curveCatmullRom);
			const farPts = ridge(s, 58, 18, 46, 10);
			far.attr("d", `M0,${H}L${farPts.map((p) => p.join(",")).join("L")}L${W},${H}Z`);
			// Snow caps on the tallest peaks: the top quarter of each slope.
			snow.attr("d", farPts.map((p, k) => {
				if (k === 0 || k === farPts.length - 1 || p[1] > 24) return "";
				const [ l, r2 ] = [ farPts[k - 1], farPts[k + 1] ];
				const f = 0.28;
				const lx = p[0] + (l[0] - p[0]) * f, ly = p[1] + (l[1] - p[1]) * f;
				const rx = p[0] + (r2[0] - p[0]) * f, ry = p[1] + (r2[1] - p[1]) * f;
				return `M${lx},${ly}L${p[0]},${p[1]}L${rx},${ry}L${(p[0] + rx) / 2},${(ly + ry) / 2 - 1}L${p[0] - 2},${ly + 1}Z`;
			}).join(""));
			near.attr("d", `M0,${H}${line(ridge(s >> 3, 74, 6, 26, 6)).replace(/^M/, "L")}L${W},${H}Z`);
			setType(structureOf(damTypeOf(r)));
			lastId = r.id;
		}
		const pct = pctAt(r, i);
		const ofAvg = ofAvgAt(data, r, i);
		const t = tone(ofAvg ?? pct ?? 1);
		const y = pct === null ? H : waterY(pct);
		const dur = reduce() ? 0 : 450;
		svg.attr("aria-label", `${r.name}: lake ${pct === null ? "level not reported this month" : `at ${fmtPct(pct)} of capacity${ofAvg === null ? "" : `, ${fmtPct(ofAvg)} of the seasonal average`}`}`)
			.attr("data-pct", pct ?? "").classed("low", pct !== null && pct < 0.6).classed("no-data", pct === null);
		water.selectAll("stop").transition().duration(dur).attr("stop-color", (d, k) => (k ? DEEP(t) : SURF(t)));
		wat.transition().duration(dur).ease(d3.easeCubicOut).attr("y", y);
		ringClip.transition().duration(dur).ease(d3.easeCubicOut).attr("y", FULL_Y).attr("height", Math.max(0, Math.min(H, y) - FULL_Y));
		surface.transition().duration(dur).ease(d3.easeCubicOut).attr("y1", y).attr("y2", y).attr("opacity", pct ? 1 : 0);
		shimmer.transition().duration(dur).ease(d3.easeCubicOut).attr("transform", `translate(0,${y})`).attr("opacity", pct ? 1 : 0);
		label.text(pct === null ? "no data" : fmtPct(pct)).transition().duration(dur).ease(d3.easeCubicOut)
			.attr("y", pct === null ? BED_Y - 6 : pct < 0.6 ? y - 5 : y + 14);
	};
}
