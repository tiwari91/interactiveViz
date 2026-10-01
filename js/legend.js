// Legend: drought colour ramp plus a mode-specific encoding key.
import { PCT_STOPS, pctColor, NO_DATA_COLOR } from "./scales.js";

const RAMP_W = 150;

function ramp() {
	const stops = PCT_STOPS.map((s) => `<stop offset="${s * 100}%" stop-color="${pctColor(s)}"/>`).join("");
	return `
		<div class="legend-item legend-ramp">
			<span class="legend-label">Storage, % of capacity</span>
			<svg width="${RAMP_W}" height="22" role="img" aria-label="Colour scale from red at 0% full to blue at 100% full">
				<defs><linearGradient id="pct-grad">${stops}</linearGradient></defs>
				<rect width="${RAMP_W}" height="8" rx="4" fill="url(#pct-grad)"/>
				<text x="0" y="20">0%</text>
				<text x="${RAMP_W / 2}" y="20" text-anchor="middle">50%</text>
				<text x="${RAMP_W}" y="20" text-anchor="end">100%</text>
			</svg>
		</div>`;
}

const KEY_2D = `
	<span class="legend-item">
		<svg width="26" height="26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="none" stroke="var(--glass)"/><circle cx="13" cy="13" r="6" fill="${pctColor(0.3)}"/></svg>
		<span>Ring = capacity<br>disc = storage</span>
	</span>`;

const KEY_3D = `
	<span class="legend-item">
		<svg width="34" height="22" aria-hidden="true"><ellipse cx="17" cy="11" rx="15" ry="9" fill="#e6dac2" stroke="#b9ab90"/><ellipse cx="19" cy="12" rx="9" ry="5" fill="#2f6f86"/></svg>
		<span>Lake = storage<br>pale banks = exposed shore</span>
	</span>
	<span class="legend-item">
		<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${pctColor(0.3)}" stroke="var(--surface)" stroke-width="1.5"/></svg>
		<span>Dot = % full</span>
	</span>`;

const KEY_COMMON = `
	<span class="legend-item">
		<svg width="30" height="10" aria-hidden="true"><path d="M2 5 Q 9 0 15 5 T 28 5" fill="none" stroke="var(--stream)" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round"/></svg>
		<span>River link, width = flow</span>
	</span>
	<span class="legend-item">
		<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="${NO_DATA_COLOR}" stroke-dasharray="2 2"/></svg>
		<span>No data</span>
	</span>`;

export function renderLegend(el, mode) {
	el.innerHTML = ramp() + (mode === "3d" ? KEY_3D : KEY_2D) + KEY_COMMON;
}
