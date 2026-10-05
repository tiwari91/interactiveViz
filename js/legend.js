// Legend: drought colour ramp plus a mode-specific encoding key.
import { pctColor, NO_DATA_COLOR, FLOOD_COLOR } from "./scales.js";

const d3 = window.d3;
const RAMP_W = 150;

// The SVG gradient blends in sRGB, so sample the HCL ramp finely instead of using its stops.
function ramp() {
	const stops = d3.range(0, 1.0001, 0.05).map((s) => `<stop offset="${(s * 100).toFixed(0)}%" stop-color="${pctColor(s)}"/>`).join("");
	return `
		<div class="legend-item legend-ramp">
			<span class="legend-label">Storage, % of capacity</span>
			<svg width="${RAMP_W}" height="22" role="img" aria-label="Colour scale from red at 0% full through yellow and green to blue at 100% full">
				<defs><linearGradient id="pct-grad">${stops}</linearGradient></defs>
				<rect width="${RAMP_W}" height="8" rx="4" fill="url(#pct-grad)"/>
				<text x="0" y="20">0%</text>
				<text x="${RAMP_W / 2}" y="20" text-anchor="middle">50%</text>
				<text x="${RAMP_W}" y="20" text-anchor="end">100%</text>
			</svg>
		</div>`;
}

// Hatch (no data) and stripe (flood control) patterns, defined once for the page.
const PATTERNS = `
	<pattern id="hatch-nodata" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
		<line x1="0" y1="0" x2="0" y2="4" stroke="${NO_DATA_COLOR}" stroke-width="1.4"/>
	</pattern>
	<pattern id="hatch-prov" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
		<line x1="0" y1="0" x2="0" y2="5" stroke="#7d8289" stroke-width="1"/>
	</pattern>
	<pattern id="stripe-flood" width="4" height="4" patternUnits="userSpaceOnUse">
		<rect width="4" height="4" fill="${FLOOD_COLOR}" fill-opacity="0.25"/>
		<line x1="0" y1="2" x2="4" y2="2" stroke="${FLOOD_COLOR}" stroke-width="1.6"/>
	</pattern>`;

const NO_DATA = `
	<span class="legend-item">
		<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="url(#hatch-nodata)" stroke="${NO_DATA_COLOR}" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>
		<span>No data (hollow, hatched)</span>
	</span>`;

const FLOOD = `
	<span class="legend-item" title="Flood-control basins are kept nearly empty by design to catch storm runoff, so they are left out of the % full and low-storage counts.">
		<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="url(#stripe-flood)" stroke="${FLOOD_COLOR}" stroke-width="1.6"/></svg>
		<span>Flood-control basin<br>(empty by design)</span>
	</span>`;

const KEY_2D = `
	<span class="legend-item">
		<svg width="26" height="26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="none" stroke="var(--glass)"/><circle cx="13" cy="13" r="6" fill="${pctColor(0.3)}"/></svg>
		<span>Ring = capacity<br>disc = storage</span>
	</span>
	<span class="legend-item">
		<svg width="30" height="10" aria-hidden="true"><path d="M2 5 Q 9 0 15 5 T 28 5" fill="none" stroke="var(--stream)" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round"/></svg>
		<span>Gauge link (data), width = flow</span>
	</span>`;

const KEY_3D = `
	<span class="legend-item">
		<svg width="30" height="20" aria-hidden="true"><ellipse cx="15" cy="10" rx="13" ry="8" fill="#ddd0b4" stroke="#b9ab90"/><ellipse cx="17" cy="11" rx="8" ry="4.5" fill="#2f6f86"/></svg>
		<span>Lake, pale banks<br>= exposed shore</span>
	</span>
	<span class="legend-item">
		<svg width="26" height="18" aria-hidden="true"><path d="M2 14 Q13 4 24 14 L24 17 Q13 7 2 17Z" fill="#cfcac0" stroke="#8f8a80"/></svg>
		<span>Dam</span>
	</span>
	<span class="legend-item">
		<svg width="30" height="12" aria-hidden="true"><path d="M2 6 C9 1 14 11 28 6" fill="none" stroke="#3d8fbf" stroke-width="4" stroke-linecap="round"/><path d="M2 6 C6 3 8 5 11 5" fill="none" stroke="#f2fbff" stroke-width="2" stroke-linecap="round"/></svg>
		<span>Outflow / river</span>
	</span>
	<span class="legend-item">
		<svg width="30" height="12" aria-hidden="true"><path d="M3 10 Q15 0 27 10" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="2.5 2.5"/><circle cx="3" cy="10" r="2" fill="var(--ink-3)"/></svg>
		<span>Gauge link (data)</span>
	</span>
	<span class="legend-item">
		<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${pctColor(0.3)}" stroke="var(--surface)" stroke-width="1.5"/></svg>
		<span>Dot = % full</span>
	</span>`;

export function ensurePatterns() {
	if (document.getElementById("hatch-nodata")) return;
	const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	holder.setAttribute("width", "0");
	holder.setAttribute("height", "0");
	holder.setAttribute("aria-hidden", "true");
	holder.style.position = "absolute";
	holder.innerHTML = `<defs>${PATTERNS}</defs>`;
	document.body.prepend(holder);
}

export function renderLegend(el, mode) {
	ensurePatterns();
	el.innerHTML = ramp() + (mode === "3d" ? KEY_3D : KEY_2D) + FLOOD + NO_DATA;
}
