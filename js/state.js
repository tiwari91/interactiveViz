// Tiny observable store shared by the views, timeline and summary.
export function createStore(initial) {
	let state = { ...initial };
	const listeners = new Set();
	return {
		get: () => state,
		set(patch) {
			const prev = state;
			state = { ...state, ...patch };
			const changed = Object.keys(patch).filter((k) => prev[k] !== state[k]);
			if (changed.length) listeners.forEach((fn) => fn(state, changed));
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}
