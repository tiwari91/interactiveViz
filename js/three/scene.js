// Renderer, camera, orbit controls and lights for the 3D view.
export function homePose(aspect) {
	return aspect < 1
		? { target: [ -20, 0, 20 ], dist: 1700, polar: 0.78, az: 0.6 }
		: { target: [ 30, 0, 40 ], dist: 1180, polar: 0.86, az: -0.08 };
}

export function createScene(THREE, container, quality) {
	THREE.ColorManagement.legacyMode = false;
	const high = quality === "high";
	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
	renderer.outputEncoding = THREE.sRGBEncoding;
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
	controls.minDistance = 22;
	controls.maxDistance = 2600;
	controls.maxPolarAngle = Math.PI * 0.44;
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

	return { renderer, scene, camera, controls, hemi, sun, resize, updateSun };
}
