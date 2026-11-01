// Keyboard movement between map marks: arrow keys go to the nearest mark on screen in that
// direction (favouring ones straight ahead). Shared by the 2D map and the wood view.
export const DIRS = { ArrowRight: [ 1, 0 ], ArrowLeft: [ -1, 0 ], ArrowDown: [ 0, 1 ], ArrowUp: [ 0, -1 ] };

export function neighbour(list, posOf, from, [ dx, dy ]) {
	const [ x0, y0 ] = posOf(from);
	let best = null;
	for (const o of list) {
		if (o === from) continue;
		const [ x, y ] = posOf(o);
		const along = (x - x0) * dx + (y - y0) * dy;
		if (along <= 0.5) continue;
		const across = Math.abs((x - x0) * dy - (y - y0) * dx);
		const score = along + across * 2.5;
		if (!best || score < best.score) best = { o, score };
	}
	return best?.o;
}

// Target of a key press from mark `from` in `list` (largest first), or null if the key isn't a move.
export function moveTarget(key, list, posOf, from) {
	if (DIRS[key]) return neighbour(list, posOf, from, DIRS[key]) ?? from;
	if (key === "Home") return list[0];
	if (key === "End") return list[list.length - 1];
	return null;
}
