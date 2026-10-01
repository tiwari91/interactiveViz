// Light/dark theme toggle. Follows the system until the user picks one.
const KEY = "cdi-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme() {
	const forced = document.documentElement.dataset.theme;
	if (forced === "light" || forced === "dark") return forced;
	return media.matches ? "dark" : "light";
}

export function initTheme(button, onChange) {
	const sync = () => {
		const theme = currentTheme();
		button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
		onChange(theme);
	};
	button.addEventListener("click", () => {
		const next = currentTheme() === "dark" ? "light" : "dark";
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem(KEY, next);
		} catch (e) { /* storage unavailable */ }
		sync();
	});
	media.addEventListener("change", sync);
	sync();
}

export function cssVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
