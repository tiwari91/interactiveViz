// Sound toggle in the header: muted by default, remembered once the user opts in.
const KEY = "cdi-sound";

const ICON_OFF = "<svg class=\"icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9.5h3.5L12 5.5v13l-4.5-4H4z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M16 9.5l5 5M21 9.5l-5 5\"/></svg>";
const ICON_ON = "<svg class=\"icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9.5h3.5L12 5.5v13l-4.5-4H4z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11\"/></svg>";

function load() {
	try {
		return JSON.parse(localStorage.getItem(KEY)) ?? {};
	} catch (e) {
		return {};
	}
}

function save(v) {
	try {
		localStorage.setItem(KEY, JSON.stringify(v));
	} catch (e) { /* storage unavailable */ }
}

export function initSoundControls(root, audio, onEnable) {
	const saved = load();
	if (typeof saved.volume === "number") audio.setVolume(saved.volume);
	root.innerHTML = `
		<button type="button" class="sound-toggle" aria-pressed="false" aria-label="Turn sound on">${ICON_OFF}</button>
		<div class="sound-pop" hidden>
			<label for="sound-volume">Volume</label>
			<input id="sound-volume" type="range" min="0" max="1" step="0.05" value="${audio.volume}">
		</div>`;
	const btn = root.querySelector(".sound-toggle");
	const pop = root.querySelector(".sound-pop");
	const slider = root.querySelector("input");

	function sync() {
		const on = !audio.muted;
		btn.innerHTML = on ? ICON_ON : ICON_OFF;
		btn.setAttribute("aria-pressed", String(on));
		btn.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
		pop.hidden = !on;
	}

	async function turnOn() {
		await audio.enable();
		onEnable();
		save({ on: true, volume: audio.volume });
		sync();
	}

	btn.addEventListener("click", async () => {
		if (audio.muted) await turnOn();
		else {
			audio.mute();
			save({ on: false, volume: audio.volume });
			sync();
		}
	});
	slider.addEventListener("input", () => {
		audio.setVolume(+slider.value);
		save({ on: !audio.muted, volume: audio.volume });
	});

	// Browsers block audio until a gesture: resume a remembered "on" at the first one.
	if (saved.on) {
		const first = () => {
			window.removeEventListener("pointerdown", first, true);
			window.removeEventListener("keydown", first, true);
			if (audio.muted) turnOn();
		};
		window.addEventListener("pointerdown", first, true);
		window.addEventListener("keydown", first, true);
	}
	document.addEventListener("visibilitychange", () => (document.hidden ? audio.suspend() : audio.resume()));
	sync();
}
