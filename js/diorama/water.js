// Water in the diorama: lake surfaces at data-driven levels, the lake seen in section on the
// front face, river ribbons with flowing ripples, concrete dams and the Feather Falls cascade.
import { BOX, FRONT, FALLS, lakeD } from "./landscape.js";
import { rippleNormals, glowTexture } from "./textures.js";

export function createWater(THREE, land, terrain, quality, motion) {
	const group = new THREE.Group();
	const clip = [
		new THREE.Plane(new THREE.Vector3(0, 0, -1), FRONT),
		new THREE.Plane(new THREE.Vector3(0, 0, 1), FRONT),
		new THREE.Plane(new THREE.Vector3(-1, 0, 0), BOX.w / 2),
		new THREE.Plane(new THREE.Vector3(1, 0, 0), BOX.w / 2),
	];
	const ripples = rippleNormals(THREE);
	ripples.repeat.set(3, 3);
	const lakeMat = new THREE.MeshStandardMaterial({
		color: 0x2d6f86, roughness: 0.13, metalness: 0.05, normalMap: ripples, normalScale: new THREE.Vector2(0.2, 0.2),
		envMapIntensity: 1.25, clippingPlanes: clip,
	});

	// One flat star-shaped polygon per lake at its rim outline; terrain hides what is under the banks.
	const lakes = land.lakes.map((L) => {
		const N = 96;
		const verts = [ 0, 0, 0 ];
		const uvs = [ 0.5, 0.5 ];
		for (let k = 0; k <= N; k++) {
			const th = k / N * Math.PI * 2;
			const [ x, z ] = land.shore(L, th, 1.0);
			verts.push(x - L.x, 0, z - L.z);
			uvs.push((x - L.x) / 3 + 0.5, (z - L.z) / 3 + 0.5);
		}
		const idx = [];
		for (let k = 1; k <= N; k++) idx.push(0, k + 1, k);
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
		g.setIndex(idx);
		g.computeVertexNormals();
		const mesh = new THREE.Mesh(g, lakeMat);
		mesh.position.set(L.x, L.rim, L.z);
		mesh.receiveShadow = true;
		group.add(mesh);
		// Invisible pick volume from the bed to just above the rim.
		const pick = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
		pick.position.set(L.x, L.rim + 0.02, L.z);
		pick.userData.lake = L;
		group.add(pick);
		return { L, mesh, pick };
	});

	// Lakes the front face cuts through: water drawn in section between the bed and the level.
	const sections = land.lakes.filter((L) => lakeD(L, L.x, FRONT) < 1.6 || Math.abs(FRONT - L.z) < L.r * L.a).map((L) => {
		const x0 = L.x - L.r * L.a * 1.4;
		const x1 = L.x + L.r * L.a * 1.4;
		const n = 90;
		const pos = new Float32Array((n + 1) * 2 * 3);
		const col = new Float32Array((n + 1) * 2 * 3);
		const idx = [];
		for (let k = 0; k < n; k++) {
			const a = k * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		g.setAttribute("color", new THREE.BufferAttribute(col, 3));
		g.setIndex(idx);
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.9, envMapIntensity: 0.6 });
		const mesh = new THREE.Mesh(g, mat);
		mesh.renderOrder = 2;
		group.add(mesh);
		// A bright meniscus line along the water surface.
		const lineG = new THREE.BufferGeometry();
		lineG.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
		const line = new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.85 }));
		group.add(line);
		const beds = [];
		const inBowl = [];
		for (let k = 0; k <= n; k++) {
			const x = x0 + (x1 - x0) * k / n;
			beds.push(terrain.sample(x, FRONT - 0.001));
			inBowl.push(lakeD(L, x, FRONT - 0.001) < 1.0);
		}
		const top = new THREE.Color(0x3f93b4);
		const deep = new THREE.Color(0x0b2f4a);
		function set(level) {
			const lp = line.geometry.attributes.position;
			for (let k = 0; k <= n; k++) {
				const x = x0 + (x1 - x0) * k / n;
				const bed = beds[k];
				const wet = inBowl[k] && level > bed;
				const y = wet ? level : bed;
				pos.set([ x, y, FRONT + 0.004, x, bed, FRONT + 0.004 ], k * 6);
				const depth = Math.max(0, level - bed) / Math.max(0.05, L.depth);
				const c2 = deep.clone().lerp(top, Math.max(0, 1 - depth * 1.2));
				col.set([ top.r, top.g, top.b, c2.r, c2.g, c2.b ], k * 6);
				lp.setXYZ(k, x, wet ? level : bed - 0.02, FRONT + 0.006);
			}
			g.attributes.position.needsUpdate = true;
			g.attributes.color.needsUpdate = true;
			lp.needsUpdate = true;
			g.computeBoundingSphere();
			g.computeVertexNormals();
		}
		return { L, set };
	});

	// Rivers: ribbons draped on the carved channels. Width follows the month's flow.
	const riverTex = ripples.clone();
	riverTex.needsUpdate = true;
	riverTex.repeat.set(1, 1);
	const riverUniforms = { uFlow: { value: 1 } };
	const riverMat = new THREE.MeshStandardMaterial({
		color: 0x3a8cad, roughness: 0.1, metalness: 0.05, normalMap: riverTex, normalScale: new THREE.Vector2(0.5, 0.5),
		envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: clip,
	});
	riverMat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, riverUniforms);
		sh.vertexShader = sh.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec2 aCenter;\nuniform float uFlow;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.xz = aCenter + (transformed.xz - aCenter) * uFlow;");
	};
	const ribbon = (path, width, lift = 0.012) => {
		const pos = [];
		const cen = [];
		const uv = [];
		const idx = [];
		let len = 0;
		path.forEach(([ x, z ], k) => {
			const [ ax, az ] = path[Math.max(0, k - 1)];
			const [ bx, bz ] = path[Math.min(path.length - 1, k + 1)];
			let tx = bx - ax;
			let tz = bz - az;
			const tl = Math.hypot(tx, tz) || 1;
			tx /= tl;
			tz /= tl;
			if (k > 0) len += Math.hypot(x - path[k - 1][0], z - path[k - 1][1]);
			const w = width * (0.75 + 0.5 * Math.min(1, k / path.length * 1.5));
			for (const sd of [ -1, 1 ]) {
				const px = x - tz * w * sd;
				const pz = z + tx * w * sd;
				pos.push(px, Math.max(terrain.sample(px, pz), terrain.sample(x, z)) + lift, pz);
				cen.push(x, z);
				uv.push(len * 2.2, (sd + 1) / 2 * 0.25);
			}
			if (k < path.length - 1) {
				const a = k * 2;
				idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
			}
		});
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute("aCenter", new THREE.Float32BufferAttribute(cen, 2));
		g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
		g.setIndex(idx);
		g.computeVertexNormals();
		const m = new THREE.Mesh(g, riverMat);
		m.receiveShadow = true;
		return m;
	};
	for (const rv of land.rivers) {
		let path = rv.path.map(([ x, z ]) => [ x, Math.min(z, FRONT - 0.002) ]);
		if (rv.kind === "in" && !rv.falls) {
			// Keep running down the exposed bed toward the middle so a low lake still has its river.
			const [ ex, ez ] = path[path.length - 1];
			for (let t = 0.1; t <= 0.75; t += 0.05) path.push([ ex + (rv.lake.x - ex) * t, ez + (rv.lake.z - ez) * t ]);
		}
		group.add(ribbon(path, rv.width));
	}

	// Dams: a concrete arch across each outlet notch, bowed upstream.
	const concrete = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.8, metalness: 0 });
	for (const L of land.lakes) {
		const rv = land.rivers.find((r) => r.kind === "out" && r.lake === L);
		const [ x, z ] = land.shore(L, L.out, 1.07);
		const toe = rv.prof[0] - 0.04;
		const crest = L.rim + 0.06;
		const span = 0.2 + L.depth * 0.42;
		const R = span * 0.9;
		const ang = 2 * Math.asin(Math.min(0.99, span / (2 * R)));
		const shape = new THREE.Shape();
		shape.absarc(0, 0, R + 0.035, -ang / 2, ang / 2, false);
		shape.absarc(0, 0, R, ang / 2, -ang / 2, true);
		const g = new THREE.ExtrudeGeometry(shape, { depth: crest - toe, bevelEnabled: false, curveSegments: 18 });
		g.rotateX(-Math.PI / 2);
		g.translate(-R, 0, 0);
		const dam = new THREE.Mesh(g, concrete);
		dam.position.set(x, toe, z);
		dam.rotation.y = -L.out;
		dam.castShadow = true;
		dam.receiveShadow = true;
		group.add(dam);
	}

	// Feather Falls: a sheet of falling water from the granite step, with mist at its foot.
	const topY = terrain.sample(FALLS.x, FALLS.top) + 0.01;
	const footY = terrain.sample(FALLS.x, FALLS.lip + 0.04) + 0.012;
	const fallsUniforms = { uTime: { value: 0 }, uFlow: { value: 1 } };
	const fallsMat = new THREE.ShaderMaterial({
		uniforms: fallsUniforms,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
		fragmentShader: `
			varying vec2 vUv; uniform float uTime; uniform float uFlow;
			float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
			float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
				return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
			void main() {
				float x = vUv.x;
				float streak = n(vec2(x * 22.0, vUv.y * 3.0 + uTime * 3.2)) * 0.6 + n(vec2(x * 50.0, vUv.y * 6.0 + uTime * 4.5)) * 0.4;
				float edge = smoothstep(0.0, 0.2, x) * smoothstep(1.0, 0.8, x);
				float a = edge * (0.45 + 0.55 * streak) * (0.35 + 0.65 * uFlow);
				vec3 c = mix(vec3(0.55, 0.75, 0.85), vec3(0.95, 0.98, 1.0), streak);
				gl_FragColor = vec4(c, a * 0.95);
			}`,
	});
	const fw = 0.16;
	const fallsG = new THREE.PlaneGeometry(fw, 1, 1, 8);
	{
		// Bend the sheet: free fall from the lip, curving out then down.
		const p = fallsG.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const t = 0.5 - p.getY(i); // 0 at top, 1 at bottom
			p.setXYZ(i, p.getX(i) * (1 + t * 0.4), topY + (footY - topY) * t, FALLS.top + 0.05 + Math.sqrt(t) * (FALLS.lip - FALLS.top));
		}
	}
	const falls = new THREE.Mesh(fallsG, fallsMat);
	falls.position.x = FALLS.x;
	falls.renderOrder = 3;
	group.add(falls);
	const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, [ [ 0, "rgba(235,245,255,0.9)" ], [ 0.5, "rgba(220,235,250,0.25)" ], [ 1, "rgba(220,235,250,0)" ] ]), transparent: true, depthWrite: false }));
	mist.position.set(FALLS.x, footY + 0.06, FALLS.lip + 0.06);
	mist.scale.set(0.45, 0.3, 1);
	group.add(mist);

	return {
		group,
		picks: lakes.map((l) => l.pick),
		// level = water height for each lake (world y); flow 0..1 for rivers and falls.
		apply(levels, flow) {
			lakes.forEach((l, i) => { l.mesh.position.y = levels[i]; });
			sections.forEach((s) => s.set(levels[s.L.index]));
			riverUniforms.uFlow.value = 0.45 + 0.75 * flow;
			fallsUniforms.uFlow.value = flow;
			mist.material.opacity = 0.25 + 0.6 * flow;
		},
		tick(t) {
			if (!motion()) return;
			ripples.offset.set(t * 0.012, t * 0.008);
			riverTex.offset.set(-t * 0.35, 0);
			fallsUniforms.uTime.value = t;
		},
	};
}

// Water height for a lake at a given fraction of capacity: depth in proportion to % full.
export function levelFor(L, pct) {
	const p = Math.max(0, Math.min(1, pct));
	return L.rim - L.depth * (1 - p) - 0.012;
}
