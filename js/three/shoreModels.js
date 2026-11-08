// Polyfork shore props (CC BY 4.0, credits in assets/polyfork/README.md): a boat launch ramp,
// a water pump house and a windmill pump. Each GLB is vertex coloured (COLOR_0) with no
// textures and sized in metres; it is flattened into one non-indexed, vertex-coloured geometry
// that the wildlife layer instances like its own box-built models.
import { addScript } from "./loader.js";

const GLTF_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js";
const FILES = {
	ramp: "boat-launch-ramp-dbde11",
	pump: "water-pump-house-121270",
	windmill: "windmill-pump-2993a4",
};

let gltfPending = null;
let pending = null;

// One geometry in metres: every mesh with its node's world matrix applied, COLOR_0 as `color`
// (RGB only; glTF colours are already linear), centred on x/z and standing on y = 0.
function flatten(THREE, root) {
	root.updateMatrixWorld(true);
	const pos = [];
	const col = [];
	const v = new THREE.Vector3();
	root.traverse((o) => {
		if (!o.isMesh) return;
		const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
		const p = src.attributes.position;
		const c = src.attributes.color;
		for (let i = 0; i < p.count; i++) {
			v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
			pos.push(v.x, v.y, v.z);
			if (c) col.push(c.getX(i), c.getY(i), c.getZ(i));
			else col.push(0.6, 0.6, 0.6);
		}
		if (src !== o.geometry) src.dispose();
	});
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
	g.computeBoundingBox();
	const bb = g.boundingBox;
	g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
	g.computeVertexNormals();
	g.computeBoundingBox();
	const b2 = g.boundingBox;
	g.userData.metres = Math.max(b2.max.x - b2.min.x, b2.max.y - b2.min.y, b2.max.z - b2.min.z);
	return g;
}

// Resolves to { ramp, pump, windmill }: geometries in metres.
export function loadShoreModels(THREE) {
	if (!pending) {
		gltfPending ??= THREE.GLTFLoader ? Promise.resolve() : addScript(GLTF_URL);
		const base = new URL("../../assets/polyfork/", import.meta.url).href;
		pending = gltfPending.then(() => {
			const loader = new THREE.GLTFLoader();
			return Promise.all(Object.entries(FILES).map(([ key, file ]) => loader.loadAsync(`${base}${file}.glb`).then((gltf) => [ key, flatten(THREE, gltf.scene) ])));
		}).then(Object.fromEntries);
		// A failed load may be retried on the next 3D build.
		pending.catch(() => {
			pending = null;
			if (!THREE.GLTFLoader) gltfPending = null;
		});
	}
	return pending;
}

// A copy in world units (scale: world units per metre, times any exaggeration), keeping its true size.
export function toWorldUnits(geom, scale) {
	const g = geom.clone();
	g.scale(scale, scale, scale);
	g.computeBoundingBox();
	g.userData.metres = geom.userData.metres;
	return g;
}
