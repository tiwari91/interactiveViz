// Hand control, after the camera tracking in California Drought Impact v2 (CHI 2017):
// move a hand left and right in front of the webcam to move through the months;
// pinch thumb and index finger to hold the month while you move away.
// Off by default. Nothing loads until the button is pressed; the video never leaves the device.
const VERSION = "0.10.14";
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Hand position across the camera (0 = left edge of the mirrored preview, 1 = right edge)
// -> month index. The middle 70% of the frame covers the whole record, so the ends are easy to reach.
export function monthFromHand(x, months) {
	const t = Math.min(1, Math.max(0, (x - 0.15) / 0.7));
	return Math.round(t * (months - 1));
}

// Thumb tip and index tip close together = a pinch (coordinates are 0..1 of the frame).
export const isPinch = (tip, thumb) => Math.hypot(tip.x - thumb.x, tip.y - thumb.y) < 0.06;

export function createHands(button, stage, store, data) {
	const panel = document.createElement("div");
	panel.className = "hands-panel";
	panel.hidden = true;
	panel.innerHTML = `
		<div class="hands-frame">
			<video class="hands-video" playsinline muted aria-hidden="true"></video>
			<span class="hands-dot" hidden></span>
		</div>
		<p class="hands-status" role="status" aria-live="polite"></p>
		<p class="hands-note">Move your hand left or right to change the month. Pinch to hold. The video stays on this device.</p>
		<button type="button" class="stage-btn hands-off">Turn off</button>`;
	stage.append(panel);
	const video = panel.querySelector("video");
	const dot = panel.querySelector(".hands-dot");
	const status = panel.querySelector(".hands-status");
	let stream = null;
	let starting = false;
	let landmarker = null;
	let raf = 0;
	let smooth = null;
	let lastVideoTime = -1;

	const say = (t) => {
		status.textContent = t;
	};

	// Each start gets a ticket; stop() takes it back, so a start still waiting on the camera
	// or the model notices it was cancelled and releases the camera instead of turning it on.
	let ticket = 0;
	async function start() {
		const mine = ++ticket;
		const cancelled = () => mine !== ticket;
		starting = true;
		panel.hidden = false;
		button.setAttribute("aria-pressed", "true");
		try {
			say("Asking for the camera…");
			const got = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false });
			if (cancelled()) {
				got.getTracks().forEach((t) => t.stop());
				return;
			}
			stream = got;
			video.srcObject = stream;
			await video.play();
			if (!landmarker) {
				say("Loading hand tracking…");
				const { FilesetResolver, HandLandmarker } = await import(LIB);
				const files = await FilesetResolver.forVisionTasks(WASM);
				landmarker = await HandLandmarker.createFromOptions(files, {
					baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
					runningMode: "VIDEO",
					numHands: 1,
				});
			}
			if (cancelled()) return; // turned off while loading; stop() already released the camera
			say("Show one hand to the camera.");
			loop();
		} catch (err) {
			if (cancelled()) return;
			say(err?.name === "NotAllowedError" ? "Camera blocked. Allow it in the browser to use hand control." : "Hand control could not start in this browser.");
			stopCamera();
		} finally {
			if (!cancelled()) starting = false;
		}
	}

	function loop() {
		raf = requestAnimationFrame(loop);
		if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
		lastVideoTime = video.currentTime;
		const out = landmarker.detectForVideo(video, performance.now());
		const hand = out.landmarks?.[0];
		if (!hand) {
			dot.hidden = true;
			return;
		}
		const tip = hand[8], thumb = hand[4];
		const x = 1 - tip.x; // the preview is mirrored, so moving right moves forward in time
		dot.hidden = false;
		dot.style.left = `${x * 100}%`;
		dot.style.top = `${tip.y * 100}%`;
		const pinch = isPinch(tip, thumb);
		dot.classList.toggle("held", pinch);
		if (pinch) {
			say("Held. Open your fingers to move again.");
			return;
		}
		smooth = smooth === null ? x : smooth + (x - smooth) * 0.25;
		const i = monthFromHand(smooth, data.months.length);
		if (i !== store.get().dateIndex) store.set({ dateIndex: i, playing: false });
		say(data.months[i]);
	}

	function stopCamera() {
		cancelAnimationFrame(raf);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		video.srcObject = null;
		smooth = null;
	}

	function stop() {
		ticket++;
		starting = false;
		stopCamera();
		panel.hidden = true;
		button.setAttribute("aria-pressed", "false");
	}

	if (!navigator.mediaDevices?.getUserMedia) button.hidden = true;
	button.addEventListener("click", () => (stream || starting ? stop() : start()));
	panel.querySelector(".hands-off").addEventListener("click", stop);
	return { stop, get active() { return Boolean(stream); } };
}
