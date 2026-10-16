// Renderer, camera, orbit controls and lights for the 3D view.
export function homePose(aspect) {
	return aspect < 1
		? { target: [ -20, 0, 20 ], dist: 1700, polar: 0.78, az: 0.6 }
		: { target: [ 30, 0, 40 ], dist: 1180, polar: 0.86, az: -0.08 };
}

// Compare split on a wide stage: California's long axis runs across the screen (seen from
// the Pacific, Sierra behind), so both halves hold reservoirs instead of the right half
// being mostly Nevada and desert.
export function comparePose(aspect) {
	// Portrait: the split runs across the screen, so north goes straight up and the line falls
	// near the middle of the state (Sierra reservoirs above, the south below).
	if (aspect < 1) return { target: [ -40, 0, 10 ], dist: 1500 * Math.min(1.3, Math.max(1, 0.6 / aspect)), polar: 0.5, az: 0 };
	if (aspect < 1.2) return null;
	return { target: [ -60, 0, -20 ], dist: 950 * Math.min(1.5, Math.max(1, 2 / aspect)), polar: 0.7, az: -1.02 };
}

export function createScene(THREE, container, quality) {
	THREE.ColorManagement.legacyMode = false;
	const high = quality === "high";
	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
	renderer.outputEncoding = THREE.sRGBEncoding;
	// Filmic tone mapping: bright sky and sun glints roll off instead of clipping to white.
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.9;
	renderer.shadowMap.enabled = high;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);
	renderer.domElement.setAttribute("aria-label", "3D terrain of California with reservoirs, dams and rivers");
	renderer.domElement.setAttribute("role", "img");

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog(0xd3e2ee, 900, 3000);
	const camera = new THREE.PerspectiveCamera(36, 1, 1, 12000);

	const controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	// Close enough to read a dam's spillway and the lake edge; the near plane follows the
	// distance (see view3d) so close views keep their depth precision.
	controls.minDistance = 7;
	controls.maxDistance = 2600;
	controls.maxPolarAngle = Math.PI * 0.42;
	controls.screenSpacePanning = false;
	controls.zoomSpeed = 0.9;

	const hemi = new THREE.HemisphereLight(0xffffff, 0x7d725c, 0.6);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff3df, 1.2);
	sun.castShadow = high;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.6;
	sun.userData.dir = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
	scene.add(sun, sun.target);

	let shadowSize = 0;
	// Keep the sun's shadow frustum around what the camera is looking at.
	function updateSun() {
		const t = controls.target;
		const dist = camera.position.distanceTo(t);
		sun.target.position.copy(t);
		sun.position.copy(t).addScaledVector(sun.userData.dir, 900);
		if (!high) return;
		const size = Math.min(700, Math.max(40, dist * 0.75));
		if (Math.abs(size - shadowSize) / size > 0.08) {
			shadowSize = size;
			Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 100, far: 1900 });
			sun.shadow.camera.updateProjectionMatrix();
		}
	}

	function resize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (!w || !h) return false;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		return true;
	}

	// Image-based lighting from the sky dome itself: the sky's colour, the bright sun side and
	// the darker ground below light every standard material (terrain, dams, trees).
	const pmrem = new THREE.PMREMGenerator(renderer);
	const envScene = new THREE.Scene();
	let envRT = null;
	function updateEnv(skyMesh, intensity = 0.5) {
		if (!envScene.children.length) envScene.add(new THREE.Mesh(skyMesh.geometry, skyMesh.material));
		const next = pmrem.fromScene(envScene, 0.02, 1, 10000);
		envRT?.dispose();
		envRT = next;
		scene.environment = envRT.texture;
		scene.traverse((o) => {
			const mats = o.material ? (Array.isArray(o.material) ? o.material : [ o.material ]) : [];
			for (const m of mats) if (m.isMeshStandardMaterial) m.envMapIntensity = intensity;
		});
	}
	function disposeEnv() {
		envRT?.dispose();
		pmrem.dispose();
	}

	return { renderer, scene, camera, controls, hemi, sun, resize, updateSun, updateEnv, disposeEnv };
}
