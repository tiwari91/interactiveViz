// Drought animations, the data side: the dry and refill fronts round each reservoir, the
// moments a reservoir crosses below 40% full, and the dated path of where the drought was worst.
// Every value here comes from the reservoirs' monthly storage (data.js); nothing is invented.
import { ofAvgAt, pctAt } from "./data.js";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Reservoirs the fronts and the path read: storage reservoirs with CDEC data. Clear Lake is a
// natural lake read off a gauge (it can read 0% in a dry autumn), so it is left out.
const frontLakes = (data) => data.tracked.filter((r) => r.purpose !== "natural-lake");

// Below this share of the month's average storage a reservoir is "dry"; the dry front grows
// with how far below it is, up to full size at 15% of average.
export const DRY_BELOW = 0.6;
export const LOW_FULL = 0.4;
// The path follows the state's largest reservoirs (a million acre-feet or more).
export const PATH_MIN_CAPACITY = 1e6;
// A key month counts as a stop only if its driest large reservoir is below 85% of average.
export const PATH_MAX_OF_AVG = 0.85;

// One entry per reservoir with a front this month: dry 0..1 (how far below 60% of average),
// wet 0..1 (above average and refilling: storage up on three months before), and radii in km.
export function frontAt(data, i) {
	const out = [];
	for (const r of frontLakes(data)) {
		const oa = ofAvgAt(data, r, i);
		if (oa === null) continue;
		const dry = clamp01((DRY_BELOW - oa) / (DRY_BELOW - 0.15));
		const before = i >= 3 ? r.series[i - 3] : null;
		const refilling = before !== null && r.series[i] > before * 1.05;
		const wet = refilling ? clamp01((oa - 0.95) / 0.35) : 0;
		if (dry <= 0 && wet <= 0) continue;
		out.push({ r, oa, dry, wet, dryKm: dry > 0 ? 22 + 68 * dry : 0, wetKm: wet > 0 ? 18 + 52 * wet : 0 });
	}
	return out;
}

// Flares for month i: a reservoir that drops below 40% full this month (it was at or above
// 40% the month before), and the month a reservoir reaches its lowest storage on record.
export function recordLows(data) {
	const at = new Map();
	for (const r of data.tracked) {
		let lo = -1;
		r.series.forEach((v, i) => {
			if (v !== null && !(r.filled && r.filled[i]) && (lo < 0 || v < r.series[lo])) lo = i;
		});
		if (lo >= 0) at.set(lo, [ ...(at.get(lo) ?? []), r ]);
	}
	return at;
}
export function flaresAt(data, i, records) {
	const out = [];
	if (i > 0) {
		for (const r of frontLakes(data)) {
			const a = pctAt(r, i - 1);
			const b = pctAt(r, i);
			if (a !== null && b !== null && a >= LOW_FULL && b < LOW_FULL) out.push({ r, kind: "cross", pct: b });
		}
	}
	for (const r of records.get(i) ?? []) if (r.purpose !== "natural-lake") out.push({ r, kind: "record", pct: pctAt(r, i) });
	// Biggest first: when only a few can play, the largest reservoirs get them.
	return out.sort((a, b) => b.r.capacity - a.r.capacity);
}

// The largest reservoir furthest below its average this month (null if none is below average).
export function driestAt(data, i, minCap = PATH_MIN_CAPACITY) {
	let best = null;
	for (const r of frontLakes(data)) {
		if (r.capacity < minCap || r.filled[i]) continue;
		const oa = ofAvgAt(data, r, i);
		if (oa !== null && oa < 1 && (!best || oa < best.oa)) best = { r, oa };
	}
	return best;
}

// The dated path for each drought: the driest large reservoir every March and September of
// the drought's years (from its label, e.g. "2012–2016"), one stop per run of the same
// reservoir (and only below 85% of average). It shows from its first stop to the end of the drought emergency.
export function droughtPaths(data) {
	return data.droughtPeriods.map((p) => {
		const yrs = (p.label.match(/\d{4}/g) ?? []).map(Number);
		const stops = [];
		if (yrs.length < 2) return null;
		for (let y = yrs[0]; y <= yrs[1]; y++) {
			for (const mm of [ "03", "09" ]) {
				const i = data.months.indexOf(`${y}-${mm}`);
				if (i < 0) continue;
				const d = driestAt(data, i);
				if (!d || d.oa >= PATH_MAX_OF_AVG) continue;
				if (stops.length && stops[stops.length - 1].r === d.r) continue;
				stops.push({ i, r: d.r, oa: d.oa, month: data.months[i] });
			}
		}
		if (!stops.length) return null;
		const end = Math.max(0, data.dates.findIndex((dt) => dt > p.end) - 1);
		return { label: p.label, stops, from: stops[0].i, to: end < stops[0].i ? data.months.length - 1 : end };
	}).filter(Boolean);
}

// How much of a path is drawn at a (fractional) month: stop k reached at its month.
export function pathProgress(path, f) {
	const s = path.stops;
	if (f < s[0].i) return 0;
	for (let k = 0; k < s.length - 1; k++) {
		if (f < s[k + 1].i) return k + (f - s[k].i) / (s[k + 1].i - s[k].i);
	}
	return s.length - 1;
}

const MON = [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ];
export const shortName = (n) => n.replace(/\s*\(.*?\)/g, "").replace(/ (Dam|Reservoir|Lake)$/, "").replace(/^Lake /, "").replace(/ Dam .*$/, "");
export const stopLabel = (s) => `${MON[+s.month.slice(5, 7) - 1]} ${s.month.slice(0, 4)} · ${shortName(s.r.name)} ${Math.round(s.oa * 100)}% of avg`;
