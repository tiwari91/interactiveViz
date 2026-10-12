// Loads three.js (UMD) and OrbitControls on first use of the 3D view.
const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.147.0/three.min.js";
const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js";

let pending = null;

function addScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.async = false;
		s.crossOrigin = "anonymous";
		s.onload = resolve;
		s.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.appendChild(s);
	});
}

export function loadThree() {
	if (!pending) {
		pending = addScript(THREE_URL).then(() => addScript(ORBIT_URL)).then(() => window.THREE);
	}
	return pending;
}

export function webglAvailable() {
	try {
		const c = document.createElement("canvas");
		return Boolean(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
	} catch (e) {
		return false;
	}
}
