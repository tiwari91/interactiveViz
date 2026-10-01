// Renderer, camera, lights and orbit controls for the 3D view.
// Home camera pose. On portrait screens orbit round so the state's long
// NW-SE axis runs up the screen, which uses a tall stage far better.
export function homePose(aspect) {
	const portrait = aspect < 1;
	const az = portrait ? 0.68 : -0.06;
	const dist = portrait ? 1080 : 880;
	const height = portrait ? 1180 : 930;
	const target = portrait ? [ 30, 0, 30 ] : [ 30, 0, 30 ];
	return { pos: [ target[0] + Math.sin(az) * dist, height, target[2] + Math.cos(az) * dist ], target };
}

export function createScene(THREE, container) {
	const coarse = window.matchMedia("(pointer: coarse)").matches;
	// Treat CSS hex colours as sRGB so materials match the page palette.
	THREE.ColorManagement.legacyMode = false;
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
	renderer.setClearColor(0x000000, 0);
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);
	renderer.domElement.setAttribute("aria-label", "3D view of California reservoirs as water columns");
	renderer.domElement.setAttribute("role", "img");

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
	camera.position.set(...homePose(container.clientWidth / Math.max(1, container.clientHeight)).pos);

	const controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.target.set(...homePose(container.clientWidth / Math.max(1, container.clientHeight)).target);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 180;
	controls.maxDistance = 2400;
	controls.maxPolarAngle = Math.PI * 0.46;
	controls.screenSpacePanning = false;
	controls.update();

	const hemi = new THREE.HemisphereLight(0xffffff, 0x9a948a, 0.62);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight(0xfff3e0, 0.95);
	sun.position.set(-420, 900, 380);
	sun.castShadow = true;
	const size = coarse ? 1024 : 2048;
	sun.shadow.mapSize.set(size, size);
	Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 620, bottom: -620, near: 200, far: 2200 });
	sun.shadow.bias = -0.0008;
	sun.shadow.radius = 4;
	scene.add(sun);

	// Soft drop shadow under the land.
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.ShadowMaterial({ opacity: 0.16 }));
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.5;
	ground.receiveShadow = true;
	scene.add(ground);

	function resize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		// Pull back a little on narrow screens so the whole state fits.
		camera.zoom = camera.aspect < 1 ? Math.min(1, 0.55 + camera.aspect * 0.45) : Math.min(1, camera.aspect / 1.15);
		camera.updateProjectionMatrix();
	}

	function setTheme(theme) {
		hemi.intensity = theme === "dark" ? 0.55 : 0.62;
		hemi.groundColor.set(theme === "dark" ? 0x202833 : 0x9a948a);
		sun.intensity = theme === "dark" ? 0.85 : 0.8;
		ground.material.opacity = theme === "dark" ? 0.35 : 0.16;
	}

	// Smoothly move the camera back to the home pose.
	function flyHome(duration = 800) {
		const fromPos = camera.position.clone();
		const fromTarget = controls.target.clone();
		const home = homePose(camera.aspect);
		const toPos = new THREE.Vector3(...home.pos);
		const toTarget = new THREE.Vector3(...home.target);
		const start = performance.now();
		return (now) => {
			const t = Math.min(1, (now - start) / duration);
			const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			camera.position.lerpVectors(fromPos, toPos, e);
			controls.target.lerpVectors(fromTarget, toTarget, e);
			return t >= 1;
		};
	}

	function placeHome(scale = 1) {
		const home = homePose(camera.aspect);
		controls.target.set(...home.target);
		camera.position.set(...home.pos).sub(controls.target).multiplyScalar(scale).add(controls.target);
		controls.update();
	}

	return { renderer, scene, camera, controls, resize, setTheme, flyHome, placeHome };
}
