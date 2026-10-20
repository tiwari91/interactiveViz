// Plant and wildlife regions round each reservoir, from its place and elevation (feet):
// southern California chaparral and sage scrub, the Sierra and northern mountains' conifers
// mixed with oaks, and the blue-oak savanna of the Central Valley foothills.
const SIERRA = new Set([ "SHA", "ORO", "FOL", "CLE", "NML", "DNP", "WHI", "BUL" ]);

export function regionOf(r) {
	if (r.lat < 35) return "socal";
	if (SIERRA.has(r.id) || r.elev >= 2000) return "sierra";
	return "foothill";
}

// Low valley-edge lakes, where white pelicans winter alongside the geese and ducks.
export const pelicanLake = (r) => r.lat >= 35.5 && r.lat < 40.5 && r.elev < 1200;
