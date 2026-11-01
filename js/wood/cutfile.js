// Laser-cutter file for one month: an SVG in millimetres, one group per sheet.
// Common laser convention: red hairline = cut, black fill = engrave (raster).
//  - Sheet 1 (birch): state outline.
//  - Sheets 2..n (birch): one terrain layer each, glued on top of the one below.
//  - Inlay (walnut): the dry area, cut from walnut and set into the stack.
//  - Engrave: month and caption, on sheet 1.
import { pathOf, DRY_BELOW, DEEP_BELOW } from "./field.js";
import { makeProjection } from "../scales.js";

const d3 = window.d3;
export const SHEET_MM = { w: 210, h: 260 };

export function cutFileSVG(data, field, i, monthLabel, statLabel) {
	const { w, h } = SHEET_MM;
	const proj = makeProjection(data.outline, w, h, 12);
	const project = (p) => proj(p);
	const outline = d3.geoPath(proj)(data.outline);
	const hair = "fill=\"none\" stroke=\"#ff0000\" stroke-width=\"0.01\"";
	const layer = (id, label, d) => `\t<g id="${id}" inkscape:label="${label}" inkscape:groupmode="layer">\n\t\t<path ${hair} d="${d}"/>\n\t</g>\n`;
	let body = layer("sheet-1-base", "Sheet 1, birch: state outline", outline);
	field.layers.forEach((l, k) => {
		body += layer(`sheet-${k + 2}-${l.metres}m`, `Sheet ${k + 2}, birch: land above ${l.metres} m`, pathOf(l.polys, project));
	});
	const dry = field.dryAt(i);
	if (dry.length) body += layer("inlay-walnut", `Inlay, walnut: below ${Math.round(DRY_BELOW * 100)}% of usual`, pathOf(dry, project));
	const deep = field.dryAt(i, DEEP_BELOW);
	if (deep.length) body += layer("inlay-dark-walnut", `Inlay, dark walnut: below ${Math.round(DEEP_BELOW * 100)}% of usual`, pathOf(deep, project));
	body += `\t<g id="engrave" inkscape:label="Engrave" inkscape:groupmode="layer" fill="#000000" font-family="Helvetica, Arial, sans-serif">
		<text x="${w - 12}" y="${h - 20}" font-size="6" text-anchor="end">${monthLabel}</text>
		<text x="${w - 12}" y="${h - 13}" font-size="3.2" text-anchor="end">${statLabel}</text>
	</g>\n`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<!-- California Drought Impact: laser-cut file for ${monthLabel}.
     After Yoon Chung Han's laser-cut wooden sculptures (2016), http://yoonchunghan.com/portfolio/california-drought-impact.html
     Red hairlines are cuts, black is engraving. Each group is its own sheet (3 mm birch or walnut). -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
${body}</svg>
`;
}

export function download(text, name) {
	const url = URL.createObjectURL(new Blob([ text ], { type: "image/svg+xml" }));
	const a = Object.assign(document.createElement("a"), { href: url, download: name });
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
