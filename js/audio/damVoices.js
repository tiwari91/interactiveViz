// Per-dam roar voices. A small pool of voices is assigned to the dams that are
// loudest at the listener (data level x distance), so several nearby dams are
// heard at once, panned by direction. Each voice's character follows its dam:
// big, full, releasing dams get a low rumble, wide band noise and sub; small or
// low ones a thin, high hiss; a running spillway adds a crashing layer.
const POOL = 4;

export function createDamVoices(ctx, bus, buffers) {
	const loop = (buf) => {
		const s = ctx.createBufferSource();
		s.buffer = buf;
		s.loop = true;
		s.start(0, Math.random() * buf.duration);
		return s;
	};
	const voices = Array.from({ length: POOL }, () => {
		const out = ctx.createGain();
		out.gain.value = 0;
		const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
		out.connect(pan).connect(bus);

		const rumbleLP = ctx.createBiquadFilter();
		rumbleLP.type = "lowpass";
		rumbleLP.Q.value = 0.7;
		const rumble = ctx.createGain();
		loop(buffers.brown).connect(rumbleLP).connect(rumble).connect(out);

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.value = 42;
		const subAM = ctx.createGain();
		subAM.gain.value = 0.6;
		const subLfo = ctx.createOscillator();
		subLfo.frequency.value = 0.7 + Math.random() * 0.5;
		const subLfoGain = ctx.createGain();
		subLfoGain.gain.value = 0.35;
		subLfo.connect(subLfoGain).connect(subAM.gain);
		const subGain = ctx.createGain();
		sub.connect(subAM).connect(subGain).connect(out);
		sub.start();
		subLfo.start();

		const bodyBP = ctx.createBiquadFilter();
		bodyBP.type = "bandpass";
		const body = ctx.createGain();
		loop(buffers.pink).connect(bodyBP).connect(body).connect(out);

		const hissHP = ctx.createBiquadFilter();
		hissHP.type = "highpass";
		const hiss = ctx.createGain();
		loop(buffers.white).connect(hissHP).connect(hiss).connect(out);

		// Spillway crash: band noise with irregular surges.
		const crashBP = ctx.createBiquadFilter();
		crashBP.type = "bandpass";
		crashBP.frequency.value = 900;
		crashBP.Q.value = 0.45;
		const crashAM = ctx.createGain();
		crashAM.gain.value = 0.7;
		const surge = ctx.createOscillator();
		surge.type = "triangle";
		surge.frequency.value = 1.3 + Math.random();
		const surgeGain = ctx.createGain();
		surgeGain.gain.value = 0.3;
		surge.connect(surgeGain).connect(crashAM.gain);
		surge.start();
		const crash = ctx.createGain();
		loop(buffers.white).connect(crashBP).connect(crashAM).connect(crash).connect(out);

		for (const g of [ rumble, subGain, body, hiss, crash ]) g.gain.value = 0;
		return { id: null, out, pan, rumbleLP, rumble, subGain, sub, bodyBP, body, hissHP, hiss, crash, state: { gain: 0, crash: 0, rumble: 0, hiss: 0 } };
	});

	const T = 0.35; // ramp time constant: smooth month changes, no clicks
	const set = (param, v, t = T) => param.setTargetAtTime(v, ctx.currentTime, t);

	function character(v, L, spill) {
		// Bigger / more flow = lower and wider; smaller = higher and thinner.
		set(v.rumbleLP.frequency, 140 + 900 * (1 - L) ** 2);
		set(v.rumble.gain, 0.9 * L ** 1.3);
		set(v.subGain.gain, 0.45 * Math.max(0, L - 0.35) ** 1.2);
		set(v.sub.frequency, 34 + 30 * (1 - L));
		set(v.bodyBP.frequency, 350 + 1900 * (1 - L));
		v.bodyBP.Q.setTargetAtTime(0.35 + 2.2 * (1 - L), ctx.currentTime, T);
		set(v.body.gain, 0.55 * L);
		set(v.hissHP.frequency, 2200 + 3500 * (1 - L));
		const hiss = 0.16 * (1 - L) * Math.min(1, L * 5);
		set(v.hiss.gain, hiss);
		const crash = spill * (0.35 + 0.65 * L) * 0.7;
		set(v.crash.gain, crash);
		v.state.rumble = 0.9 * L ** 1.3;
		v.state.hiss = hiss;
		v.state.crash = crash;
	}

	// sources: [{ id, level, spill, gain, pan }] where gain already includes distance/focus.
	function update(sources) {
		const wanted = sources.filter((s) => s.gain > 0.004).sort((a, b) => b.gain - a.gain).slice(0, POOL);
		const keep = new Set(wanted.map((s) => s.id));
		// Free voices whose dam dropped out (fade them).
		for (const v of voices) {
			if (v.id && !keep.has(v.id)) {
				set(v.out.gain, 0, 0.25);
				v.state.gain = 0;
				v.id = null;
			}
		}
		for (const s of wanted) {
			let v = voices.find((x) => x.id === s.id);
			if (!v) {
				v = voices.find((x) => !x.id);
				if (!v) continue;
				v.id = s.id;
			}
			character(v, s.level, s.spill);
			set(v.out.gain, Math.min(1.2, s.gain));
			if (v.pan.pan) set(v.pan.pan, Math.max(-1, Math.min(1, s.pan)), 0.2);
			v.state.gain = Math.min(1.2, s.gain);
		}
	}

	return {
		update,
		snapshot: () => voices.filter((v) => v.id).map((v) => ({ id: v.id, ...v.state, live: v.out.gain.value })),
	};
}
