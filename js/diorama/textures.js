// Procedural canvas textures for the diorama: wood, water ripples, sprites and the brass plate.
import { hash2, fbm } from "../three/world.js";

function canvas(w, h) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}

// Dark walnut: long wavy grain lines over a warm base. Tiles along x.
export function woodTexture(THREE, { base = [ 58, 36, 22 ], dark = [ 30, 18, 10 ], w = 512, h = 256, seed = 1 } = {}) {
	const c = canvas(w, h);
	const g = c.getContext("2d");
	const img = g.createImageData(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// Grain runs along x; its phase wanders with low-frequency noise so lines bend.
			const u = x / w;
			const v = y / h;
			const warp = fbm(u * 3 + seed, v * 2, 3) * 3.2 + Math.sin(u * Math.PI * 2) * 0.15;
			const lines = 0.5 + 0.5 * Math.sin((v * 46 + warp * 6) * Math.PI);
			const fine = hash2(x * 7 + seed, y * 13) * 0.18;
			const t = Math.min(1, Math.pow(lines, 3) * 0.8 + fine + fbm(u * 18, v * 30 + seed, 2) * 0.25);
			const i = (y * w + x) * 4;
			for (let k = 0; k < 3; k++) img.data[i + k] = base[k] + (dark[k] - base[k]) * t;
			img.data[i + 3] = 255;
		}
	}
	g.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.encoding = THREE.sRGBEncoding;
	tex.anisotropy = 8;
	return tex;
}

// Tileable ripple normal map built from a periodic height field.
export function rippleNormals(THREE, size = 256) {
	const hgt = new Float32Array(size * size);
	const TAU = Math.PI * 2;
	const waves = [];
	for (let k = 0; k < 14; k++) {
		// Integer wave numbers keep the field periodic over the tile.
		const kx = Math.round((hash2(k, 3) - 0.5) * 12);
		const ky = Math.round((hash2(k, 7) - 0.5) * 12) || 1;
		waves.push([ kx, ky, hash2(k, 11) * TAU, 1 / Math.hypot(kx, ky) ]);
	}
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let v = 0;
			for (const [ kx, ky, ph, a ] of waves) v += Math.sin(TAU * (kx * x + ky * y) / size + ph) * a;
			hgt[y * size + x] = v;
		}
	}
	const c = canvas(size, size);
	const g = c.getContext("2d");
	const img = g.createImageData(size, size);
	const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
			const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
			const len = Math.hypot(dx, dy, 1);
			const i = (y * size + x) * 4;
			img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
			img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
			img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
			img.data[i + 3] = 255;
		}
	}
	g.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

// Soft round glow, used for the lens flare, mist and snowflakes.
export function glowTexture(THREE, stops = [ [ 0, "rgba(255,240,215,1)" ], [ 0.18, "rgba(255,214,160,0.55)" ], [ 0.5, "rgba(255,190,120,0.12)" ], [ 1, "rgba(255,180,110,0)" ] ]) {
	const c = canvas(128, 128);
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
	for (const [ o, col ] of stops) grad.addColorStop(o, col);
	g.fillStyle = grad;
	g.fillRect(0, 0, 128, 128);
	const tex = new THREE.CanvasTexture(c);
	tex.encoding = THREE.sRGBEncoding;
	return tex;
}

// A thin vertical streak for raindrops drawn as point sprites.
export function streakTexture(THREE) {
	const c = canvas(32, 64);
	const g = c.getContext("2d");
	const grad = g.createLinearGradient(0, 0, 0, 64);
	grad.addColorStop(0, "rgba(255,255,255,0)");
	grad.addColorStop(0.55, "rgba(235,244,255,0.9)");
	grad.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = grad;
	g.fillRect(13, 0, 6, 64);
	const tex = new THREE.CanvasTexture(c);
	return tex;
}

// Engraved brass plate: two lines of text on brushed brass.
export function drawPlate(c, title, line) {
	const g = c.getContext("2d");
	const { width: w, height: h } = c;
	const grad = g.createLinearGradient(0, 0, w, h);
	grad.addColorStop(0, "#b8913f");
	grad.addColorStop(0.45, "#e2c47a");
	grad.addColorStop(0.55, "#d0aa58");
	grad.addColorStop(1, "#9c7630");
	g.fillStyle = grad;
	g.fillRect(0, 0, w, h);
	// Brushed lines.
	for (let y = 0; y < h; y += 2) {
		g.fillStyle = `rgba(${hash2(y, 1) > 0.5 ? "255,240,200" : "80,55,20"},${0.04 + hash2(y, 2) * 0.05})`;
		g.fillRect(0, y, w, 1);
	}
	g.strokeStyle = "rgba(70,48,15,0.75)";
	g.lineWidth = 3;
	g.strokeRect(10, 10, w - 20, h - 20);
	g.textAlign = "center";
	g.textBaseline = "middle";
	const engrave = (text, y, size, weight) => {
		g.font = `${weight} ${size}px Fraunces, Georgia, serif`;
		g.fillStyle = "rgba(255,240,205,0.55)";
		g.fillText(text, w / 2 + 1, y + 1.5);
		g.fillStyle = "#3a2708";
		g.fillText(text, w / 2, y);
	};
	engrave(title, h * 0.38, h * 0.26, 650);
	g.font = `500 ${h * 0.15}px "IBM Plex Sans", system-ui, sans-serif`;
	g.fillStyle = "rgba(255,240,205,0.5)";
	g.fillText(line, w / 2 + 1, h * 0.72 + 1);
	g.fillStyle = "#3d2a0c";
	g.fillText(line, w / 2, h * 0.72);
}

export function plateTexture(THREE) {
	const c = canvas(1024, 160);
	const tex = new THREE.CanvasTexture(c);
	tex.encoding = THREE.sRGBEncoding;
	tex.anisotropy = 8;
	return { tex, set(title, line) {
		drawPlate(c, title, line);
		tex.needsUpdate = true;
	} };
}
