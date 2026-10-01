// Quality setting: "low" on phones and small screens, "high" elsewhere; remembered.
const KEY = "cdi-quality";

export function defaultQuality() {
	const coarse = window.matchMedia("(pointer: coarse)").matches;
	return coarse || window.innerWidth < 760 ? "low" : "high";
}

export function getQuality() {
	const q = new URLSearchParams(location.search).get("quality");
	if (q === "low" || q === "high") return q;
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === "low" || saved === "high") return saved;
	} catch (e) { /* storage unavailable */ }
	return defaultQuality();
}

export function saveQuality(q) {
	try {
		localStorage.setItem(KEY, q);
	} catch (e) { /* storage unavailable */ }
}
