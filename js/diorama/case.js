// The museum case: renderer, studio lighting and reflections, tabletop, wooden plinth with a brass
// name plate, glass walls with green-tinted edges and brass corner posts and rims.
import { BOX } from "./landscape.js";
import { woodTexture, plateTexture } from "./textures.js";

export const CASE = { margin: 0.28, top: 4.75, plinthH: 1.25 };
export const KEY_LIGHT = [ -9.5, 13, 7.5 ];

// A dark studio with one warm softbox (where the key light is) and a cool strip, prefiltered for
// image-based reflections on brass, glass and water.
function studioEnvironment(THREE, renderer) {
	const env = new THREE.Scene();
	const room = new THREE.Mesh(new THREE.BoxGeometry(40, 24, 40), new THREE.MeshBasicMaterial({ color: 0x0d0e11, side: THREE.BackSide }));
	room.position.y = 8;
	env.add(room);
	const panel = (w, h, rgb, pos, look) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
		m.material.color.setRGB(...rgb);
		m.position.set(...pos);
		m.lookAt(...look);
		env.add(m);
	};
	panel(9, 6, [ 7, 5.2, 3.4 ], KEY_LIGHT.map((v) => v * 1.1), [ 0, 0, 0 ]);
	panel(16, 1.6, [ 0.45, 0.6, 0.85 ], [ 14, 6, -10 ], [ 0, 2, 0 ]);
	panel(20, 2, [ 0.5, 0.42, 0.34 ], [ -4, 1, 16 ], [ 0, 3, 0 ]);
	panel(30, 30, [ 0.06, 0.045, 0.035 ], [ 0, -3.2, 0 ], [ 0, 10, 0 ]);
	panel(34, 9, [ 0.22, 0.2, 0.18 ], [ 0, 7, 19 ], [ 0, 3, 0 ]);
	const pm = new THREE.PMREMGenerator(renderer);
	const tex = pm.fromScene(env, 0.035).texture;
	pm.dispose();
	return tex;
}

export function createStage(THREE, container, quality) {
	const high = quality === "high";
	THREE.ColorManagement.legacyMode = false;
	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	renderer.shadowMap.enabled = high;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.localClippingEnabled = true;
	renderer.setClearColor(0x08090b, 1);
	container.appendChild(renderer.domElement);
	renderer.domElement.setAttribute("role", "img");
	renderer.domElement.setAttribute("aria-label", "A glass museum case holding a model of California's water system: Sierra Nevada snowpack, rivers and reservoirs whose levels follow the selected month");

	const scene = new THREE.Scene();
	scene.environment = studioEnvironment(THREE, renderer);
	scene.fog = new THREE.Fog(0x08090b, 28, 60);

	const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
	const controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.07;
	controls.enablePan = false;
	controls.minDistance = 8;
	controls.maxDistance = 34;
	controls.minPolarAngle = 0.3;
	controls.maxPolarAngle = 1.42;
	controls.rotateSpeed = 0.6;
	controls.zoomSpeed = 0.8;
	controls.autoRotateSpeed = 0.35;
	controls.target.set(0, 0.55, 0);

	// One warm key spotlight from the top left; dim cool fill and rim so the shadows are not black.
	const key = new THREE.SpotLight(0xffd8a8, 2.8, 0, 0.42, 0.7, 1);
	key.position.set(...KEY_LIGHT);
	key.target.position.set(0.4, 0.2, 0.2);
	key.castShadow = high;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.bias = -0.00025;
	key.shadow.normalBias = 0.02;
	key.shadow.camera.near = 8;
	key.shadow.camera.far = 34;
	key.shadow.radius = 3;
	scene.add(key, key.target);
	scene.add(new THREE.HemisphereLight(0x7d8fae, 0x20160d, 0.32));
	const fill = new THREE.DirectionalLight(0x9db3d6, 0.22);
	fill.position.set(10, 4, 9);
	const rim = new THREE.DirectionalLight(0x86a6d8, 0.4);
	rim.position.set(6, 7, -12);
	scene.add(fill, rim);

	return { renderer, scene, camera, controls, key };
}

export function createCase(THREE, quality) {
	const high = quality === "high";
	const group = new THREE.Group();
	const W = BOX.w + CASE.margin * 2;
	const D = BOX.d + CASE.margin * 2;
	const y0 = BOX.base;
	const H = CASE.top - y0;

	// Tabletop: dark oiled wood.
	const tableTex = woodTexture(THREE, { base: [ 34, 22, 15 ], dark: [ 14, 9, 6 ], seed: 4 });
	tableTex.repeat.set(4, 6);
	tableTex.rotation = Math.PI / 2;
	const tableY = y0 - CASE.plinthH;
	const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.42, metalness: 0, envMapIntensity: 0.5 }));
	table.rotation.x = -Math.PI / 2;
	table.position.y = tableY;
	table.receiveShadow = true;
	group.add(table);

	// Plinth: walnut block with a stepped base and a brass rim at the top.
	const wood = woodTexture(THREE, { base: [ 72, 42, 24 ], dark: [ 34, 19, 10 ], seed: 2 });
	wood.repeat.set(1.5, 1);
	const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.38, metalness: 0, envMapIntensity: 0.9 });
	const brass = new THREE.MeshStandardMaterial({ color: 0xd6ad5c, metalness: 1, roughness: 0.26, envMapIntensity: 1.4 });
	const box = (w, h, d, mat, x, y, z) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
		m.position.set(x, y, z);
		m.castShadow = high;
		m.receiveShadow = true;
		group.add(m);
		return m;
	};
	const PW = W + 0.7;
	const PD = D + 0.7;
	box(PW + 0.22, 0.16, PD + 0.22, woodMat, 0, tableY + 0.08, 0);
	box(PW, CASE.plinthH - 0.16, PD, woodMat, 0, tableY + 0.16 + (CASE.plinthH - 0.16) / 2, 0);
	box(PW + 0.04, 0.05, PD + 0.04, brass, 0, y0 - 0.025, 0);

	// Glass: transmission on high quality; a reflective transparent pane on low.
	const glass = high
		? new THREE.MeshPhysicalMaterial({ color: 0xf1f8f3, roughness: 0.03, metalness: 0, transmission: 0.97, thickness: 0.04, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.2, attenuationColor: new THREE.Color(0xe4f4ea), attenuationDistance: 3, depthWrite: false })
		: new THREE.MeshPhysicalMaterial({ color: 0xdfeee6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.6, depthWrite: false });
	// A fresnel sheen and two soft diagonal streaks make the panes read as glass from any angle.
	const sheen = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
			void main() {
				vUv = uv;
				vec4 wp = modelMatrix * vec4(position, 1.0);
				vN = normalize(mat3(modelMatrix) * normal);
				vV = cameraPosition - wp.xyz;
				gl_Position = projectionMatrix * viewMatrix * wp;
			}`,
		fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
			void main() {
				float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 5.0);
				float s = vUv.x * 0.9 + vUv.y * 0.55;
				float streak = exp(-pow((s - 0.42) / 0.07, 2.0)) * 0.6 + exp(-pow((s - 0.56) / 0.018, 2.0)) * 0.4;
				float a = 0.012 + f * 0.2 + streak * 0.045;
				gl_FragColor = vec4(vec3(0.9, 0.97, 0.94), a);
			}`,
	});
	const pane = (w, h, x, y, z, ry, rx = 0) => {
		const g = new THREE.PlaneGeometry(w, h);
		const m = new THREE.Mesh(g, glass);
		m.position.set(x, y, z);
		m.rotation.set(rx, ry, 0);
		m.renderOrder = 5;
		const sh = new THREE.Mesh(g, sheen);
		sh.position.copy(m.position);
		sh.rotation.copy(m.rotation);
		sh.renderOrder = 6;
		group.add(m, sh);
	};
	const cy = y0 + H / 2;
	pane(W, H, 0, cy, D / 2, 0);
	pane(W, H, 0, cy, -D / 2, Math.PI);
	pane(D, H, W / 2, cy, 0, Math.PI / 2);
	pane(D, H, -W / 2, cy, 0, -Math.PI / 2);
	pane(W, D, 0, CASE.top, 0, 0, -Math.PI / 2);

	// Glass seen edge-on is green: thin tinted strips along every edge, inside the brass.
	const edgeMat = new THREE.MeshStandardMaterial({ color: 0x7fcfa6, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.7, envMapIntensity: 1.2, depthWrite: false });
	const e = 0.032;
	for (const sx of [ -1, 1 ]) {
		for (const sz of [ -1, 1 ]) {
			const m = new THREE.Mesh(new THREE.BoxGeometry(e, H, e), edgeMat);
			m.position.set(sx * (W / 2 - 0.055), cy, sz * (D / 2 - 0.055));
			m.renderOrder = 6;
			group.add(m);
		}
	}
	for (const sz of [ -1, 1 ]) {
		const m = new THREE.Mesh(new THREE.BoxGeometry(W, e, e), edgeMat);
		m.position.set(0, CASE.top - 0.06, sz * (D / 2));
		m.renderOrder = 6;
		group.add(m);
	}
	for (const sx of [ -1, 1 ]) {
		const m = new THREE.Mesh(new THREE.BoxGeometry(e, e, D), edgeMat);
		m.position.set(sx * (W / 2), CASE.top - 0.06, 0);
		m.renderOrder = 6;
		group.add(m);
	}

	// Brass corner posts, top rim and foot rim.
	const t = 0.065;
	for (const sx of [ -1, 1 ]) {
		for (const sz of [ -1, 1 ]) {
			box(t, H, t, brass, sx * W / 2, cy, sz * D / 2);
			// Little finials on top.
			const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), brass);
			f.position.set(sx * W / 2, CASE.top + 0.07, sz * D / 2);
			group.add(f);
		}
	}
	for (const yy of [ CASE.top, y0 + 0.03 ]) {
		const hgt = yy === CASE.top ? 0.07 : 0.06;
		box(W + t, hgt, t, brass, 0, yy, D / 2);
		box(W + t, hgt, t, brass, 0, yy, -D / 2);
		box(t, hgt, D + t, brass, W / 2, yy, 0);
		box(t, hgt, D + t, brass, -W / 2, yy, 0);
	}
	// The floor of the case around the slice.
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.8 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = y0 + 0.001;
	floor.receiveShadow = true;
	group.add(floor);

	// Brass name plate on the front of the plinth.
	const plate = plateTexture(THREE);
	const plateMat = new THREE.MeshStandardMaterial({ map: plate.tex, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.3 });
	const plateMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.56, 0.03), [ brass, brass, brass, brass, plateMat, brass ]);
	plateMesh.position.set(0, tableY + 0.16 + (CASE.plinthH - 0.16) / 2, PD / 2 + 0.016);
	group.add(plateMesh);

	return { group, plate, tableY };
}
