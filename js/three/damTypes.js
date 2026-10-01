// Dam construction types. The big ones follow the real structures; the rest use
// the common type for their size and setting. Approximate, for illustration.
export const DAM_TYPES = {
	"gravity-arch": "Concrete gravity-arch",
	arch: "Concrete arch",
	gravity: "Concrete gravity",
	earthfill: "Earthfill embankment",
	rockfill: "Rockfill embankment",
};

const LOOKUP = {
	SHA: "gravity-arch", ORO: "earthfill", FOL: "gravity", NML: "rockfill", DNP: "earthfill",
	CLE: "earthfill", PNF: "gravity", BUL: "arch", BER: "arch", PAR: "gravity-arch", MIL: "gravity",
	CLA: "gravity", ALM: "earthfill", CMN: "earthfill", NHG: "earthfill", ISB: "earthfill",
	DMV: "earthfill", CAS: "earthfill", PYM: "rockfill", CHV: "rockfill", HHL: "rockfill",
	UNV: "earthfill", WHI: "earthfill", STP: "earthfill", BLB: "earthfill", TRM: "earthfill",
	COY: "earthfill", WRS: "earthfill", INV: "earthfill", SVO: "earthfill", PRA: "earthfill",
	PRR: "earthfill", BCL: "rockfill", SLS: "rockfill", WSN: "rockfill", CTG: "rockfill",
};

export function damTypeOf(r) {
	return LOOKUP[r.id] ?? (r.elev > 3000 ? "rockfill" : "earthfill");
}

export const isConcrete = (type) => type === "arch" || type === "gravity" || type === "gravity-arch";
