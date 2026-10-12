// Riparian trees and boulders along the river banks. Conifers are tiered, tapered crowns on a
// trunk; broadleaf trees are clumps of irregular lobes. Both are vertex-shaded darker below,
// sit on a soft contact shadow, grow only where the ground is vegetated, crowd the water's
// edge in groves, and shrink away with distance so the state overview never shows dots.
import { fbm, hash2 } from "./world.js";
import { vegetation } from "./terrain.js";

const FADE_NEAR = 160;
const FADE_FAR = 320;

// Merge non-indexed geometries, colouring each part (darker toward its own base).
function merge(THREE, parts) {
	const pos = [];
	const nrm = [];
	const col = [];
	const c = new THREE.Color();
	for (const { geom, color, shade = 0.45 } of parts) {
		const g = geom.index ? geom.toNonIndexed() : geom;
		g.computeVertexNormals();
		g.computeBoundingBox();
		const { min, max } = g.boundingBox;
		const p = g.attributes.position;
		const n = g.attributes.normal;
		for (let i = 0; i < p.count; i++) {
			pos.push(p.getX(i), p.getY(i), p.getZ(i));
			nrm.push(n.getX(i), n.getY(i), n.getZ(i));
			// Self-shading: lower and downward-facing parts of a crown are darker.
			const h = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
			const k = 1 - shade + shade * (0.55 * h + 0.45 * (n.getY(i) * 0.5 + 0.5));
			c.set(color).multiplyScalar(k);
			col.push(c.r, c.g, c.b);
		}
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
	out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
	return out;
}

function jitter(geom, amount, seed) {
	const p = geom.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i);
		const y = p.getY(i);
		const z = p.getZ(i);
		const k = 1 + (hash2(Math.round(x * 97) + seed, Math.round((y + z) * 89)) - 0.5) * amount;
		p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.5), z * k);
	}
	return geom;
}

function conifer(THREE) {
	const parts = [];
	const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5);
	trunk.translate(0, 0.25, 0);
	parts.push({ geom: trunk, color: 0x4a3524, shade: 0.3 });
	// Three tiers, each a slightly drooping cone, narrowing to a spire.
	[ [ 0.42, 0.75, 0.3 ], [ 0.33, 0.62, 0.66 ], [ 0.22, 0.55, 0.98 ] ].forEach(([ r, h, y ], k) => {
		const g = jitter(new THREE.ConeGeometry(r, h, 7, 1), 0.25, k * 13);
		g.translate(0, y + h / 2, 0);
		parts.push({ geom: g, color: 0x2f4a33, shade: 0.55 });
	});
	return merge(THREE, parts);
}

function broadleaf(THREE) {
	const parts = [];
	const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.42, 5);
	trunk.translate(0, 0.21, 0);
	parts.push({ geom: trunk, color: 0x4f3a28, shade: 0.3 });
	// A clump of overlapping lobes of different sizes.
	[ [ 0, 0.68, 0, 0.36 ], [ 0.22, 0.58, 0.08, 0.27 ], [ -0.18, 0.6, -0.12, 0.29 ], [ 0.05, 0.86, -0.08, 0.25 ], [ -0.08, 0.55, 0.2, 0.24 ] ].forEach(([ x, y, z, r ], k) => {
		const g = jitter(new THREE.IcosahedronGeometry(r, 1), 0.35, k * 31 + 5);
		g.scale(1, 0.85, 1);
		g.translate(x, y, z);
		parts.push({ geom: g, color: 0x4d6a34, shade: 0.6 });
	});
	return merge(THREE, parts);
}

// Instances shrink to nothing between FADE_NEAR and FADE_FAR from the camera.
function fadeByDistance(mat) {
	mat.onBeforeCompile = (sh) => {
		sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
	{
		vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
		float f = 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, distance(base, cameraPosition));
		transformed *= f;
	}`);
	};
	return mat;
}

export function createRiparian(THREE, outflow, router, basins, world, quality) {
	const high = quality === "high";
	const maxTrees = high ? 8000 : 2200;
	const maxRocks = high ? 1400 : 400;
	let seed = 11;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	const treeMat = fadeByDistance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
	const rockMat = fadeByDistance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
	const pines = new THREE.InstancedMesh(conifer(THREE), treeMat, maxTrees);
	const broads = new THREE.InstancedMesh(broadleaf(THREE), treeMat, maxTrees);
	const rock = new THREE.DodecahedronGeometry(0.28, 0);
	const rocks = new THREE.InstancedMesh(rock, rockMat, maxRocks);
	// Soft contact shadow under every tree (also on Low quality, where there is no shadow map).
	const blobTex = (() => {
		const c = document.createElement("canvas");
		c.width = c.height = 64;
		const g = c.getContext("2d");
		const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grad.addColorStop(0, "rgba(0,0,0,0.55)");
		grad.addColorStop(1, "rgba(0,0,0,0)");
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
		return new THREE.CanvasTexture(c);
	})();
	const blobGeom = new THREE.PlaneGeometry(1, 1);
	blobGeom.rotateX(-Math.PI / 2);
	const blobMat = fadeByDistance(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
	const blobs = new THREE.InstancedMesh(blobGeom, blobMat, maxTrees * 2);
	blobs.renderOrder = 1;
	for (const m of [ pines, broads, rocks ]) {
		m.castShadow = high;
		m.receiveShadow = true;
	}
	// Instances spread over the whole state; the base geometry's bounds would cull them.
	for (const m of [ pines, broads, rocks, blobs ]) m.frustumCulled = false;

	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();
	const s = new THREE.Vector3();
	const v = new THREE.Vector3();
	const c = new THREE.Color();
	const counts = { pine: 0, broad: 0, rock: 0, rejected: 0 };
	const damAt = basins.basins.map((b) => [ ...b.toWorld(b.dam.u - 0.6, 0), b.dam.halfWidth * 1.15 + 1 ]);
	const onLake = (x, z) => {
		if (damAt.some(([ dx, dz, r ]) => Math.hypot(x - dx, z - dz) < r) || outflow.nearChute(x, z)) return true;
		const sfc = basins.surfaceAt(x, z);
		return Boolean(sfc && (sfc.zone === "bowl" || sfc.zone === "shore"));
	};
	// Woodiness of the ground at a point: elevation belt, slope, desert, from the same rules as the colours.
	const woody = (x, z) => {
		const [ lon, lat ] = world.unproject(x, z);
		const m = world.metresAt(lon, lat);
		const d = 0.6;
		const hx = router.surface(x + d, z) - router.surface(x - d, z);
		const hz = router.surface(x, z + d) - router.surface(x, z - d);
		const slopeY = 2 * d / Math.hypot(hx, 2 * d, hz);
		return { veg: vegetation(m, slopeY, lon, lat), m };
	};
	const placed = [];
	const blob = (x, y, z, r) => {
		if (blobs.count >= maxTrees * 2) return;
		m4.compose(v.set(x, y + 0.02, z), q.identity(), s.set(r, 1, r));
		blobs.setMatrixAt(blobs.count++, m4);
	};
	blobs.count = 0;
	const tree = (x, z, nearWater) => {
		if (counts.pine + counts.broad >= maxTrees || onLake(x, z)) return;
		const { veg, m } = woody(x, z);
		// Groves: a low-frequency noise gates where trees gather; right by the water they always may.
		const grove = fbm(x * 0.35 + 3, z * 0.35, 3);
		if (veg < 0.05 || rnd() > Math.min(1, veg * 1.7) * (nearWater ? 1 : smoothstep(0.38, 0.58, grove))) {
			counts.rejected++;
			return;
		}
		const y = router.surface(x, z);
		const isConifer = m > 900 + hash2(Math.round(x), Math.round(z)) * 500;
		const sc = (isConifer ? 0.75 : 0.6) + rnd() * 0.45;
		e.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
		q.setFromEuler(e);
		s.set(sc * (0.85 + rnd() * 0.3), sc * (0.9 + rnd() * 0.35), sc * (0.85 + rnd() * 0.3));
		m4.compose(v.set(x, y - 0.04, z), q, s);
		const mesh = isConifer ? pines : broads;
		const key = isConifer ? "pine" : "broad";
		mesh.setMatrixAt(counts[key], m4);
		// Small brightness and hue variation per tree; the crown colour comes from the geometry.
		mesh.setColorAt(counts[key], c.setHSL(0.25 + (rnd() - 0.5) * 0.08, 0.25, 0.42 + rnd() * 0.16).multiplyScalar(2));
		counts[key]++;
		blob(x, y, z, sc * (isConifer ? 1.1 : 1.3));
		placed.push({ x, z, m, veg });
	};
	function smoothstep(a, b, x) {
		const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
		return t * t * (3 - 2 * t);
	}

	// Nearest the dams first, so every river gets its trees before the budget runs out.
	const bank = outflow.bankPoints(high ? 0.7 : 1.2).sort((a, b) => a.along - b.along);
	for (const p of bank) {
		for (const side of [ -1, 1 ]) {
			const n = high ? 5 : 2;
			for (let k = 0; k < n; k++) {
				// Squared distribution: most trees stand right at the water's edge.
				const t = rnd();
				const off = p.half * (1.02 + t * t * 2.6) + 0.15;
				const along = (rnd() - 0.5) * 0.9;
				tree(p.x + p.sx * off * side + p.sz * along, p.z + p.sz * off * side - p.sx * along, t < 0.35);
			}
			if (rnd() < 0.4 && counts.rock < maxRocks) {
				const off = p.half * (0.95 + rnd() * 0.25);
				const x = p.x + p.sx * off * side;
				const z = p.z + p.sz * off * side;
				if (onLake(x, z)) continue;
				const y = router.surface(x, z);
				const sc = 0.45 + rnd() * 0.6;
				e.set(rnd(), rnd() * 6, rnd());
				q.setFromEuler(e);
				m4.compose(v.set(x, y - 0.05, z), q, s.set(sc, sc * 0.6, sc));
				rocks.setMatrixAt(counts.rock, m4);
				rocks.setColorAt(counts.rock, c.setHSL(0.08, 0.06, 0.3 + rnd() * 0.14));
				counts.rock++;
			}
		}
	}
	pines.count = counts.pine;
	broads.count = counts.broad;
	rocks.count = counts.rock;
	for (const m of [ pines, broads, rocks, blobs ]) {
		m.instanceMatrix.needsUpdate = true;
		if (m.instanceColor) m.instanceColor.needsUpdate = true;
	}
	const group = new THREE.Group();
	group.add(blobs, pines, broads, rocks);
	return {
		group,
		counts,
		fade: [ FADE_NEAR, FADE_FAR ],
		// For tests: lowest vegetation value under any placed tree.
		minVegetation: () => placed.reduce((a, p) => Math.min(a, p.veg), 1),
	};
}
