// Procedural sound with the Web Audio API: no audio files.
// - Ambient bed follows the data: water (wet months) vs wind and cicadas (drought).
// - Per-dam roar voices whose loudness and character follow storage, size and release,
//   placed by the 3D camera's distance and direction.
// - Quiet interface sounds: hover tick, select chime, fly-to whoosh, timeline tick, replay swell.
import { createDamVoices } from "./damVoices.js";

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function noiseBuffer(ctx, seconds, kind) {
	const len = Math.floor(ctx.sampleRate * seconds);
	const buf = ctx.createBuffer(2, len, ctx.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const d = buf.getChannelData(ch);
		let last = 0;
		let b0 = 0;
		let b1 = 0;
		let b2 = 0;
		for (let i = 0; i < len; i++) {
			const w = Math.random() * 2 - 1;
			if (kind === "brown") {
				last = (last + 0.02 * w) / 1.02;
				d[i] = last * 3.5;
			} else if (kind === "pink") {
				b0 = 0.99765 * b0 + w * 0.099046;
				b1 = 0.963 * b1 + w * 0.2965164;
				b2 = 0.57 * b2 + w * 1.0526913;
				d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
			} else d[i] = w;
		}
	}
	return buf;
}

export function createAudio() {
	let ctx = null;
	let nodes = null;
	let volume = 0.5;
	let muted = true;
	let lastTick = 0;
	let built = 0;
	let levels = new Map(); // id -> { level, size, spill, ... } for the current month
	let listener = null; // 3D: [{ id, dist, pan }]; null in 2D
	let focus = null;
	let solo = null;
	let lastSources = [];

	// Turn data levels + listener position into per-dam voice gains.
	function sourcesNow() {
		const out = [];
		for (const [ id, v ] of levels) {
			if (v.level <= 0) continue;
			let gain = 0;
			let pan = 0;
			if (solo) {
				if (id !== solo) continue;
				gain = 0.12 + 0.88 * v.level;
			} else if (listener) {
				const l = listener.get(id);
				if (!l) continue;
				const reach = 45 + 110 * v.size;
				gain = v.level ** 1.15 / (1 + (l.dist / reach) ** 2);
				if (id === focus) gain = Math.max(gain, v.level ** 1.15 * 0.8) * 1.25;
				pan = l.pan;
			} else if (id === focus) {
				gain = 0.85 * v.level ** 1.15;
			} else continue;
			out.push({ id, level: v.level, spill: v.spill, gain, pan });
		}
		return out;
	}

	function mixDams() {
		if (!ctx) return;
		lastSources = sourcesNow();
		nodes.voices.update(lastSources);
		ramp(nodes.ambient.gain, solo ? 0.25 : 1, 0.4);
	}

	function loop(buffer) {
		const s = ctx.createBufferSource();
		s.buffer = buffer;
		s.loop = true;
		s.loopStart = Math.random() * 0.5;
		s.start(0, Math.random() * buffer.duration);
		return s;
	}

	function lfo(freq, depth, target, offset = 0) {
		const o = ctx.createOscillator();
		o.frequency.value = freq;
		const g = ctx.createGain();
		g.gain.value = depth;
		o.connect(g).connect(target);
		o.start();
		if (offset) target.value = offset;
		built += 2;
		return o;
	}

	function build() {
		ctx = new (window.AudioContext || window.webkitAudioContext)();
		const master = ctx.createGain();
		master.gain.value = 0;
		// Glue compressor, then a fast limiter so loud wet-year scenes never clip.
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -20;
		comp.ratio.value = 3;
		comp.knee.value = 10;
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -3;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.002;
		limiter.release.value = 0.2;
		master.connect(comp).connect(limiter).connect(ctx.destination);
		const brown = noiseBuffer(ctx, 4, "brown");
		const pink = noiseBuffer(ctx, 4, "pink");
		const white = noiseBuffer(ctx, 2, "white");

		// Ambient bed and dam voices on separate buses so a solo can duck the bed.
		const ambient = ctx.createGain();
		ambient.gain.value = 1;
		ambient.connect(master);
		const damBus = ctx.createGain();
		damBus.gain.value = 0.9;
		damBus.connect(master);
		const voices = createDamVoices(ctx, damBus, { brown, pink, white });

		// Water: brown noise through a moving low-pass, plus a bubbling band.
		const waterLP = ctx.createBiquadFilter();
		waterLP.type = "lowpass";
		waterLP.frequency.value = 700;
		const waterGain = ctx.createGain();
		waterGain.gain.value = 0;
		loop(brown).connect(waterLP).connect(waterGain).connect(ambient);
		const babbleBP = ctx.createBiquadFilter();
		babbleBP.type = "bandpass";
		babbleBP.frequency.value = 1100;
		babbleBP.Q.value = 2.5;
		const babbleAmp = ctx.createGain();
		babbleAmp.gain.value = 0.5;
		const babbleGain = ctx.createGain();
		babbleGain.gain.value = 0;
		loop(pink).connect(babbleBP).connect(babbleAmp).connect(babbleGain).connect(ambient);
		lfo(0.37, 0.35, babbleAmp.gain, 0.5);
		lfo(0.11, 260, babbleBP.frequency, 1100);

		// Dry wind: pink noise, slowly sweeping band-pass.
		const windBP = ctx.createBiquadFilter();
		windBP.type = "bandpass";
		windBP.frequency.value = 500;
		windBP.Q.value = 0.8;
		const windGain = ctx.createGain();
		windGain.gain.value = 0;
		loop(pink).connect(windBP).connect(windGain).connect(ambient);
		lfo(0.06, 260, windBP.frequency, 520);

		// Cicadas: a high tone, buzzing amplitude and slow on/off pulses.
		const cic = ctx.createOscillator();
		cic.frequency.value = 4700;
		const cicAM = ctx.createGain();
		cicAM.gain.value = 0;
		const cicPulse = ctx.createGain();
		cicPulse.gain.value = 0.5;
		const cicGain = ctx.createGain();
		cicGain.gain.value = 0;
		cic.connect(cicAM).connect(cicPulse).connect(cicGain).connect(ambient);
		cic.start();
		lfo(42, 0.5, cicAM.gain, 0.5);
		lfo(0.23, 0.5, cicPulse.gain, 0.5);


		// Interface sounds share one bus.
		const ui = ctx.createGain();
		ui.gain.value = calm() ? 0.4 : 0.8;
		ui.connect(master);

		built += 20;
		nodes = { master, waterLP, waterGain, babbleGain, windBP, windGain, cicGain, ambient, damBus, voices, ui, white };
		mixDams();
	}

	const ramp = (param, value, t = 0.6) => param.setTargetAtTime(value, ctx.currentTime, t);

	function blip(freq, dur, gain, type = "sine") {
		if (!ctx || muted) return;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.value = freq;
		const g = ctx.createGain();
		const t = ctx.currentTime;
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(nodes.ui);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	const api = {
		get ready() {
			return Boolean(ctx);
		},
		// Must be called from a user gesture.
		async enable() {
			if (!ctx) build();
			if (ctx.state === "suspended") await ctx.resume();
			muted = false;
			ramp(nodes.master.gain, volume, 0.3);
		},
		mute() {
			muted = true;
			if (!ctx) return;
			ramp(nodes.master.gain, 0, 0.15);
		},
		setVolume(v) {
			volume = Math.max(0, Math.min(1, v));
			if (ctx && !muted) ramp(nodes.master.gain, volume, 0.1);
		},
		get muted() {
			return muted;
		},
		get volume() {
			return volume;
		},
		suspend() {
			if (ctx && ctx.state === "running") ctx.suspend();
		},
		resume() {
			if (ctx && !muted && ctx.state === "suspended") ctx.resume();
		},
		// Statewide mood for the month: wet 0..1 (storage), flow 0..1 (river flow).
		setMonth(wet, flow) {
			if (!ctx) return;
			const dry = 1 - wet;
			const k = calm() ? 0.7 : 1;
			ramp(nodes.waterGain.gain, (0.02 + 0.4 * wet + 0.12 * flow) * k, 1.2);
			ramp(nodes.waterLP.frequency, 380 + 1500 * wet + 600 * flow, 1.2);
			ramp(nodes.babbleGain.gain, (0.02 + 0.14 * wet * (0.5 + flow)) * k, 1.2);
			ramp(nodes.windGain.gain, (0.01 + 0.28 * dry * dry) * k, 1.5);
			ramp(nodes.cicGain.gain, Math.max(0, dry - 0.35) * 0.03 * k, 2);
		},
		// Per-dam data levels for the month (from release.js voicesAt).
		setDamLevels(map) {
			levels = map;
			mixDams();
		},
		// 3D listener: distance and pan to every dam, or null when not in 3D.
		setListener(list) {
			listener = list ? new Map(list.map((l) => [ l.id, l ])) : null;
			mixDams();
		},
		setFocus(id) {
			focus = id;
			mixDams();
		},
		setSolo(id) {
			solo = id;
			mixDams();
		},
		get solo() {
			return solo;
		},
		// The dam's own data level (0..1), independent of the camera.
		levelOf(id) {
			return levels.get(id)?.level ?? 0;
		},
		hover() {
			blip(1320, 0.07, 0.035);
		},
		select() {
			blip(880, 0.5, 0.06);
			setTimeout(() => blip(1318.5, 0.6, 0.045), 70);
		},
		tick() {
			if (!ctx) return;
			const now = performance.now();
			if (now - lastTick < 90) return;
			lastTick = now;
			blip(2400, 0.025, 0.02, "triangle");
		},
		whoosh() {
			if (!ctx || muted || calm()) return;
			const s = ctx.createBufferSource();
			s.buffer = nodes.white;
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			bp.Q.value = 1.2;
			const g = ctx.createGain();
			const t = ctx.currentTime;
			bp.frequency.setValueAtTime(300, t);
			bp.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
			bp.frequency.exponentialRampToValueAtTime(400, t + 1.1);
			g.gain.setValueAtTime(0, t);
			g.gain.linearRampToValueAtTime(0.09, t + 0.35);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
			s.connect(bp).connect(g).connect(nodes.ui);
			s.start(t);
			s.stop(t + 1.3);
		},
		// Low pad that swells while the drought replay runs.
		swell(on) {
			if (!ctx) return;
			if (on && !nodes.pad) {
				const g = ctx.createGain();
				g.gain.value = 0;
				const lp = ctx.createBiquadFilter();
				lp.type = "lowpass";
				lp.frequency.value = 600;
				const oscs = [ 55, 82.4, 110.2 ].map((f, i) => {
					const o = ctx.createOscillator();
					o.type = i === 1 ? "sine" : "sawtooth";
					o.frequency.value = f;
					o.detune.value = (i - 1) * 6;
					o.connect(lp);
					o.start();
					return o;
				});
				lp.connect(g).connect(nodes.ui);
				ramp(g.gain, calm() ? 0.025 : 0.05, 2.5);
				nodes.pad = { g, oscs };
			} else if (!on && nodes.pad) {
				const pad = nodes.pad;
				nodes.pad = null;
				ramp(pad.g.gain, 0, 0.8);
				setTimeout(() => pad.oscs.forEach((o) => o.stop()), 4000);
			}
		},
		// For tests: data levels and what each live voice is doing.
		debugLevels() {
			return {
				levels: Object.fromEntries([ ...levels ].map(([ id, v ]) => [ id, { level: +v.level.toFixed(3), spill: +v.spill.toFixed(3) } ])),
				sources: lastSources.map((x) => ({ id: x.id, gain: +x.gain.toFixed(3), spill: +x.spill.toFixed(3) })),
				voices: ctx ? nodes.voices.snapshot() : [],
			};
		},
		debugState() {
			return { context: ctx ? ctx.state : "none", nodes: built, muted, gain: ctx ? nodes.master.gain.value : 0 };
		},
	};
	return api;
}
