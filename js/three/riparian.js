// Riparian trees and boulders along the river banks: instanced, a handful of draw calls,
// fewer on Low quality. Placed once on the ground beside each river's widest course.
import { hash2 } from "./world.js";

export function createRiparian(THREE, outflow, router, basins, quality) {
	const high = quality === "high";
	const maxTrees = high ? 7000 : 2000;
	const maxRocks = high ? 1600 : 500;
	let seed = 11;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	// A tiered conifer and a rounded broadleaf crown, both low-poly.
	const pine = new THREE.ConeGeometry(0.32, 1.1, 6);
	pine.translate(0, 0.55, 0);
	const crown = new THREE.IcosahedronGeometry(0.42, 1);
	crown.translate(0, 0.62, 0);
	const rock = new THREE.DodecahedronGeometry(0.28, 0);
	const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
	const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
	const pines = new THREE.InstancedMesh(pine, leafMat, maxTrees);
	const broads = new THREE.InstancedMesh(crown, leafMat, maxTrees);
	const rocks = new THREE.InstancedMesh(rock, rockMat, maxRocks);
	for (const m of [ pines, broads, rocks ]) {
		m.castShadow = high;
		m.receiveShadow = true;
		// Instances spread over the whole state; the base geometry's bounds would cull them.
		m.frustumCulled = false;
	}

	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();
	const s = new THREE.Vector3();
	const v = new THREE.Vector3();
	const c = new THREE.Color();
	const counts = { pine: 0, broad: 0, rock: 0 };
	// Not on lake beds or shores, and not out at sea.
	const damAt = basins.basins.map((b) => [ ...b.toWorld(b.dam.u - 0.6, 0), b.dam.halfWidth * 1.15 + 1 ]);
	const dry = (x, z) => {
		if (damAt.some(([ dx, dz, r ]) => Math.hypot(x - dx, z - dz) < r)) return false;
		const sfc = basins.surfaceAt(x, z);
		return !(sfc && (sfc.zone === "bowl" || sfc.zone === "shore"));
	};
	const put = (mesh, key, x, z, scale, color, squash = 1) => {
		const y = router.surface(x, z);
		if (y < 0.4 || !dry(x, z)) return;
		e.set((rnd() - 0.5) * 0.15, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.15);
		q.setFromEuler(e);
		s.set(scale, scale * squash, scale);
		m4.compose(v.set(x, y - 0.05, z), q, s);
		mesh.setMatrixAt(counts[key], m4);
		mesh.setColorAt(counts[key], color);
		counts[key]++;
	};

	// Nearest the dams first, so every river gets its trees before any budget runs out.
	const bank = outflow.bankPoints(high ? 0.9 : 1.5).sort((a, b) => a.along - b.along);
	for (const p of bank) {
		for (const side of [ -1, 1 ]) {
			// A loose gallery of trees a little back from the water, boulders right at its edge.
			const n = high ? 3 : 1;
			for (let k = 0; k < n; k++) {
				if (counts.pine + counts.broad >= maxTrees) break;
				const off = p.half * (1.25 + rnd() * 1.6) + 0.3;
				const jitter = (rnd() - 0.5) * 0.8;
				const x = p.x + p.sx * off * side + p.sz * jitter;
				const z = p.z + p.sz * off * side - p.sx * jitter;
				const y = router.surface(x, z);
				// Conifers up in the mountains, oaks and cottonwoods in the foothills and valley.
				const conifer = y > 6 + hash2(Math.round(x), Math.round(z)) * 4;
				if (conifer) put(pines, "pine", x, z, 0.55 + rnd() * 0.4, c.setHSL(0.31 + rnd() * 0.04, 0.35, 0.16 + rnd() * 0.06), 1);
				else if (counts.broad < maxTrees) put(broads, "broad", x, z, 0.45 + rnd() * 0.35, c.setHSL(0.22 + rnd() * 0.07, 0.42, 0.15 + rnd() * 0.07), 0.85 + rnd() * 0.3);
			}
			if (rnd() < 0.45 && counts.rock < maxRocks) {
				const off = p.half * (0.95 + rnd() * 0.3);
				put(rocks, "rock", p.x + p.sx * off * side, p.z + p.sz * off * side, 0.5 + rnd() * 0.7, c.setHSL(0.08, 0.06, 0.32 + rnd() * 0.14), 0.6);
			}
		}
	}
	pines.count = counts.pine;
	broads.count = counts.broad;
	rocks.count = counts.rock;
	for (const m of [ pines, broads, rocks ]) {
		m.instanceMatrix.needsUpdate = true;
		if (m.instanceColor) m.instanceColor.needsUpdate = true;
	}
	const group = new THREE.Group();
	group.add(pines, broads, rocks);
	return { group, counts };
}
