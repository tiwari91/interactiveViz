// Riparian trees and boulders along the river banks. Conifers are tiered, tapered crowns on a
// trunk; broadleaf trees are clumps of irregular lobes. Both are vertex-shaded darker below,
// sit on a soft contact shadow, grow only where the ground is vegetated, crowd the water's
// edge in groves, and shrink away with distance so the state overview never shows dots.
import { fbm, hash2 } from "./world.js";
import { vegetation } from "./terrain.js";
import { regionOf } from "./regions.js";

const FADE_NEAR = 160;
const FADE_FAR = 320;

// Merge non-indexed geometries, colouring each part (darker toward its own base).
function merge(THREE, parts) {
	const pos = [];
	const nrm = [];
	const col = [];
	const c = new THREE.Color();
	for (const { geom, color, shade = 0.45, round = null } of parts) {
		// Smooth normals: shared across faces of an indexed part, or pointing out from a lobe's
		// centre, so crowns read as soft rounded masses rather than facets.
		if (geom.index) geom.computeVertexNormals();
		const g = geom.index ? geom.toNonIndexed() : geom;
		if (round) {
			const pp = g.attributes.position;
			const nn = new Float32Array(pp.count * 3);
			for (let i = 0; i < pp.count; i++) {
				const dx = pp.getX(i) - round[0];
				const dy = (pp.getY(i) - round[1]) * 0.8 + 0.12;
				const dz = pp.getZ(i) - round[2];
				const l = Math.hypot(dx, dy, dz) || 1;
				nn.set([ dx / l, dy / l, dz / l ], i * 3);
			}
			g.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
		} else if (!geom.index) g.computeVertexNormals();
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
			// Leaf-clump mottling so a crown is never one flat colour.
			c.set(color).multiplyScalar(k * (0.82 + 0.36 * hash2(Math.round(p.getX(i) * 53), Math.round((p.getY(i) + p.getZ(i)) * 61))));
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

function broadleaf(THREE, detail = 0) {
	const parts = [];
	const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.42, 5);
	trunk.translate(0, 0.21, 0);
	parts.push({ geom: trunk, color: 0x4f3a28, shade: 0.3 });
	// A clump of overlapping lobes of different sizes.
	[ [ 0, 0.68, 0, 0.36 ], [ 0.22, 0.58, 0.08, 0.27 ], [ -0.18, 0.6, -0.12, 0.29 ], [ 0.05, 0.86, -0.08, 0.25 ], [ -0.08, 0.55, 0.2, 0.24 ], [ 0.16, 0.78, -0.16, 0.22 ], [ -0.2, 0.8, 0.1, 0.21 ] ].forEach(([ x, y, z, r ], k) => {
		// Low-poly lobes (20 faces each): the clump shape carries the look, not the facets.
		const g = jitter(new THREE.IcosahedronGeometry(r, detail), detail ? 0.35 : 0.3, k * 31 + 5);
		g.scale(1, 0.85, 1);
		g.translate(x, y, z);
		parts.push({ geom: g, color: 0x4d6a34, shade: 0.6, round: [ x, y, z ] });
	});
	return merge(THREE, parts);
}

// A spreading oak: short trunk, a wide, flattish crown of lobes (blue oak, live oak).
function oak(THREE) {
	const parts = [];
	const trunk = new THREE.CylinderGeometry(0.06, 0.1, 0.38, 5);
	trunk.translate(0, 0.19, 0);
	parts.push({ geom: trunk, color: 0x4a3a2c, shade: 0.3 });
	[ [ 0, 0.56, 0, 0.32 ], [ 0.3, 0.5, 0.08, 0.25 ], [ -0.28, 0.5, -0.06, 0.26 ], [ 0.06, 0.6, 0.3, 0.23 ], [ -0.08, 0.52, -0.3, 0.24 ], [ 0.22, 0.6, -0.22, 0.2 ], [ -0.22, 0.6, 0.2, 0.2 ] ].forEach(([ x, y, z, r ], k) => {
		const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.3, k * 17 + 3);
		g.scale(1, 0.7, 1);
		g.translate(x, y, z);
		parts.push({ geom: g, color: 0xa0a0a0, shade: 0.6, round: [ x, y, z ] });
	});
	return merge(THREE, parts);
}

// A willow thicket: several thin stems under upright, narrow lobes, low and bushy.
function willow(THREE) {
	const parts = [];
	for (const [ x, z, lean ] of [ [ 0.05, 0, 0.1 ], [ -0.07, 0.05, -0.12 ], [ 0.02, -0.08, 0.06 ] ]) {
		const st = new THREE.CylinderGeometry(0.02, 0.03, 0.36, 4);
		st.translate(0, 0.18, 0);
		st.rotateZ(lean);
		st.translate(x, 0, z);
		parts.push({ geom: st, color: 0x5a4a32, shade: 0.3 });
	}
	[ [ 0, 0.42, 0, 0.2 ], [ 0.14, 0.36, 0.06, 0.17 ], [ -0.13, 0.38, -0.05, 0.18 ], [ 0.03, 0.56, 0.02, 0.15 ], [ -0.05, 0.32, 0.15, 0.16 ], [ 0.08, 0.34, -0.15, 0.15 ] ].forEach(([ x, y, z, r ], k) => {
		const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.3, k * 23 + 9);
		g.scale(0.85, 1.35, 0.85);
		g.translate(x, y, z);
		parts.push({ geom: g, color: 0xa0a0a0, shade: 0.55, round: [ x, y, z ] });
	});
	return merge(THREE, parts);
}

// Species: which mesh draws it, its crown colour, and its shape ranges (scale, width, height).
// Instance colours are the crown colour over the mesh's own crown colour, so trunks stay brown.
const SPECIES = {
	ponderosa: { mesh: "conifer", crown: 0x2b4a2e, sc: [ 0.7, 1.1 ], w: [ 0.7, 0.9 ], h: [ 1.25, 1.7 ] },
	grayPine: { mesh: "conifer", crown: 0x66755c, sc: [ 0.55, 0.8 ], w: [ 0.45, 0.6 ], h: [ 1.1, 1.45 ] },
	blackOak: { mesh: "broad", crown: 0x55703a, sc: [ 0.5, 0.9 ], w: [ 0.95, 1.3 ], h: [ 0.85, 1.05 ] },
	cottonwood: { mesh: "broad", crown: 0x7c9a3a, sc: [ 0.65, 1.1 ], w: [ 0.85, 1.1 ], h: [ 1.15, 1.45 ] },
	liveOak: { mesh: "oak", crown: 0x3e5530, sc: [ 0.55, 0.95 ], w: [ 1.0, 1.35 ], h: [ 0.8, 1.0 ] },
	blueOak: { mesh: "oak", crown: 0x7b876a, sc: [ 0.5, 0.85 ], w: [ 0.95, 1.25 ], h: [ 0.8, 1.0 ] },
	willow: { mesh: "willow", crown: 0x8fa04a, sc: [ 0.55, 0.95 ], w: [ 0.9, 1.3 ], h: [ 0.9, 1.2 ] },
};
const SHRUBS = {
	chaparral: { crown: 0x4f5c34, sc: [ 0.3, 0.55 ] },
	sage: { crown: 0x99a088, sc: [ 0.22, 0.4 ] },
	brush: { crown: 0x5f7038, sc: [ 0.22, 0.42 ] },
};

// Instances shrink to nothing between FADE_NEAR and FADE_FAR from the camera.
// Trees keep their shape when the land's vertical scale changes with zoom (view3d).
const unsquash = { value: 1 };
function fadeByDistance(mat) {
	mat.onBeforeCompile = (sh) => {
		sh.uniforms.uUnsquash = unsquash;
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uUnsquash;").replace("#include <begin_vertex>", `#include <begin_vertex>
	transformed.y *= uUnsquash;
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
	const maxForest = high ? 9000 : 1600;
	const maxShrubs = high ? 8000 : 1200;
	const maxRocks = high ? 1400 : 400;
	let seed = 11;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	const treeMat = fadeByDistance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
	const rockMat = fadeByDistance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
	const broadGeom = broadleaf(THREE, 0);
	const pines = new THREE.InstancedMesh(conifer(THREE), treeMat, maxTrees + maxForest);
	const broads = new THREE.InstancedMesh(broadGeom, treeMat, maxTrees + maxForest);
	// Low shrubs: the broadleaf clump, squashed and small.
	const shrubs = new THREE.InstancedMesh(broadGeom, treeMat, maxShrubs);
	const oaks = new THREE.InstancedMesh(oak(THREE), treeMat, maxTrees + maxForest);
	const willows = new THREE.InstancedMesh(willow(THREE), treeMat, maxTrees);
	const meshOf = { conifer: pines, broad: broads, oak: oaks, willow: willows };
	// Each mesh's own crown colour, which an instance colour scales to the species' colour.
	const baseCrown = { conifer: 0x2f4a33, broad: 0x4d6a34, oak: 0xa0a0a0, willow: 0xa0a0a0, shrub: 0x4d6a34 };
	const crownTint = (mesh, hex, jit) => {
		const b = new THREE.Color(baseCrown[mesh]);
		c.set(hex);
		c.setRGB(c.r / b.r, c.g / b.g, c.b / b.b).multiplyScalar(jit);
		return c;
	};
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
	const blobs = new THREE.InstancedMesh(blobGeom, blobMat, (maxTrees + maxForest) * 2);
	blobs.renderOrder = 1;
	for (const m of [ pines, broads, rocks, shrubs, oaks, willows ]) {
		m.castShadow = high;
		m.receiveShadow = true;
	}
	// Instances spread over the whole state; the base geometry's bounds would cull them.
	for (const m of [ pines, broads, rocks, blobs, shrubs, oaks, willows ]) m.frustumCulled = false;

	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();
	const s = new THREE.Vector3();
	const v = new THREE.Vector3();
	const c = new THREE.Color();
	const counts = { pine: 0, broad: 0, rock: 0, shrub: 0, bank: 0, forest: 0, rejected: 0, species: {} };
	const used = { conifer: 0, broad: 0, oak: 0, willow: 0 };
	// The region (socal, sierra, foothill) of the reservoir nearest a point.
	const regionDams = basins.basins.map((b) => ({ at: b.toWorld(b.dam.u, 0), region: regionOf(b.r) }));
	const regionAt = (x, z) => {
		let best = null;
		let bd = Infinity;
		for (const d of regionDams) {
			const dd = (d.at[0] - x) ** 2 + (d.at[1] - z) ** 2;
			if (dd < bd) {
				bd = dd;
				best = d.region;
			}
		}
		return best;
	};
	// Which tree grows here: willows and cottonwoods by the water; ponderosa with black oak up
	// high and gray pine with live oak lower in the Sierra; blue oak savanna in the foothills;
	// coast live oak (and sycamore-like cottonwood) among the southern scrub.
	const pickSpecies = (region, m, wet, riparianBank) => {
		const h = rnd();
		if (wet) return h < 0.55 ? "willow" : "cottonwood";
		if (riparianBank && h < 0.45) return "cottonwood";
		if (region === "socal") return h < 0.75 ? "liveOak" : "cottonwood";
		if (region === "foothill") return h < 0.72 ? "blueOak" : h < 0.88 ? "grayPine" : "liveOak";
		if (m > 900) return h < 0.72 ? "ponderosa" : "blackOak";
		return h < 0.3 ? "grayPine" : h < 0.6 ? "ponderosa" : h < 0.82 ? "liveOak" : "blackOak";
	};
	const lerp = ([ a, b ], t) => a + (b - a) * t;
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
		if (blobs.count >= (maxTrees + maxForest) * 2) return;
		m4.compose(v.set(x, y + 0.02, z), q.identity(), s.set(r, 1, r));
		blobs.setMatrixAt(blobs.count++, m4);
	};
	blobs.count = 0;
	const tree = (x, z, nearWater, forest = false, bankSide = false) => {
		if ((forest ? counts.forest >= maxForest : counts.bank >= maxTrees) || onLake(x, z)) return;
		const { veg, m } = woody(x, z);
		const region = regionAt(x, z);
		// Groves: a low-frequency noise gates where trees gather; right by the water they always may.
		// Foothill savanna is open: single trees scattered over the grass, sparser and ungrouped.
		const grove = fbm(x * 0.35 + 3, z * 0.35, 3);
		const savanna = region === "foothill" && !nearWater && !bankSide;
		const gate = nearWater || savanna ? 1 : smoothstep(0.38, 0.58, grove);
		if (veg < 0.05 || rnd() > Math.min(1, veg * (savanna ? 0.7 : 1.7)) * gate) {
			counts.rejected++;
			return;
		}
		// Southern hills carry chaparral and sage scrub, with few trees.
		if (region === "socal" && !nearWater && rnd() < (bankSide ? 0.4 : 0.8)) {
			const n = 2 + Math.floor(rnd() * 3);
			for (let k = 0; k < n; k++) shrub(x + (rnd() - 0.5) * 1.4, z + (rnd() - 0.5) * 1.4, rnd() < 0.6 ? "chaparral" : "sage");
			counts.rejected++;
			return;
		}
		const y = router.surface(x, z);
		const name = pickSpecies(region, m, nearWater, bankSide);
		const sp = SPECIES[name];
		if (sp.mesh === "willow" && used.willow >= maxTrees) return;
		// Mostly young trees with the odd big one, so a stand never reads as identical copies.
		const r0 = rnd();
		const sc = lerp(sp.sc, r0 * r0);
		e.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
		q.setFromEuler(e);
		const w = lerp(sp.w, rnd());
		s.set(sc * w, sc * lerp(sp.h, rnd()), sc * w * (0.85 + rnd() * 0.3));
		m4.compose(v.set(x, y - 0.04, z), q, s);
		const mesh = meshOf[sp.mesh];
		mesh.setMatrixAt(used[sp.mesh], m4);
		// Small brightness variation per tree on the species' crown colour.
		mesh.setColorAt(used[sp.mesh], crownTint(sp.mesh, sp.crown, 0.85 + rnd() * 0.3));
		used[sp.mesh]++;
		counts[sp.mesh === "conifer" ? "pine" : "broad"]++;
		counts.species[name] = (counts.species[name] ?? 0) + 1;
		counts[forest ? "forest" : "bank"]++;
		blob(x, y, z, sc * (sp.mesh === "conifer" ? 1.1 : 1.3));
		placed.push({ x, z, m, veg });
	};
	function smoothstep(a, b, x) {
		const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
		return t * t * (3 - 2 * t);
	}

	// Nearest the dams first, so every river gets its trees before the budget runs out.
	const bank = outflow.bankPoints(high ? 0.7 : 1.2).sort((a, b) => a.along - b.along);
	function shrub(x, z, kind = "brush") {
		if (counts.shrub >= maxShrubs || onLake(x, z)) return;
		const { veg } = woody(x, z);
		if (veg < 0.05) return;
		const y = router.surface(x, z);
		const sp = SHRUBS[kind];
		const sc = lerp(sp.sc, rnd());
		e.set(0, rnd() * Math.PI * 2, 0);
		q.setFromEuler(e);
		m4.compose(v.set(x, y - 0.12 * sc, z), q, s.set(sc * (1.2 + rnd() * 0.6), sc * (0.55 + rnd() * 0.3), sc * (1.2 + rnd() * 0.6)));
		shrubs.setMatrixAt(counts.shrub, m4);
		shrubs.setColorAt(counts.shrub, crownTint("shrub", sp.crown, 0.85 + rnd() * 0.3));
		counts.shrub++;
		counts.species[kind] = (counts.species[kind] ?? 0) + 1;
	}
	for (const p of bank) {
		for (const side of [ -1, 1 ]) {
			// Gaps: stretches of each bank (different on the two sides) carry no trees at all,
			// others are thick; the count per step varies so nothing lines up in rows.
			const cover = fbm(p.x * 0.09 + side * 13.7, p.z * 0.09 - side * 5.3, 3);
			if (cover < 0.4) {
				if (rnd() < 0.5) shrub(p.x + p.sx * p.half * (1.1 + rnd()) * side, p.z + p.sz * p.half * (1.1 + rnd()) * side);
				continue;
			}
			const n = Math.round((high ? 7 : 3) * smoothstep(0.4, 0.75, cover) * (0.4 + rnd() * 0.9));
			for (let k = 0; k < n; k++) {
				// Squared distribution: most trees stand right at the water's edge.
				const t = rnd();
				const off = p.half * (1.02 + t * t * 3.2) + 0.15 + rnd() * 0.3;
				const along = (rnd() - 0.5) * 2.4;
				tree(p.x + p.sx * off * side + p.sz * along, p.z + p.sz * off * side - p.sx * along, t < 0.35, false, true);
			}
			for (let k = 0; k < (high ? 2 : 1); k++) {
				const off = p.half * (1.0 + rnd() * 2.4) + 0.1;
				const along = (rnd() - 0.5) * 2;
				const sx = p.x + p.sx * off * side + p.sz * along;
				const sz = p.z + p.sz * off * side - p.sx * along;
				shrub(sx, sz, regionAt(sx, sz) === "socal" ? (rnd() < 0.5 ? "chaparral" : "sage") : "brush");
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
	// Forest and woodland on the hills around each reservoir (where people fly in), in groves,
	// as dense as the ground is wooded. Biggest reservoirs first.
	const byCap = [ ...basins.basins ].sort((a, b) => b.r.capacity - a.r.capacity);
	// Mountain forest is densest, foothill savanna open, southern scrub mostly shrubs; bigger
	// basins cover more ground.
	const WEIGHT = { sierra: 1.7, foothill: 0.8, socal: 0.6 };
	const share = (b) => WEIGHT[regionOf(b.r)] * Math.sqrt(b.Lu * 1.8 + 14);
	const totalShare = byCap.reduce((a, b) => a + share(b), 0);
	for (const b of byCap) {
		const perBasin = Math.ceil(maxForest * share(b) / totalShare);
		const R = b.Lu * 1.8 + 14;
		let placedHere = 0;
		for (let tries = 0; tries < perBasin * 6 && placedHere < perBasin; tries++) {
			const a = rnd() * Math.PI * 2;
			const d = Math.sqrt(rnd()) * R;
			const [ cx, cz ] = b.toWorld(b.dam.u * 0.2, 0);
			const x = cx + Math.cos(a) * d;
			const z = cz + Math.sin(a) * d;
			const before = counts.forest;
			if (fbm(x * 0.12 + 40, z * 0.12, 3) < 0.47) continue;
			tree(x, z, false, true);
			if (counts.forest > before) placedHere++;
		}
	}
	pines.count = used.conifer;
	broads.count = used.broad;
	oaks.count = used.oak;
	willows.count = used.willow;
	rocks.count = counts.rock;
	shrubs.count = counts.shrub;
	for (const m of [ pines, broads, rocks, blobs, shrubs, oaks, willows ]) {
		m.instanceMatrix.needsUpdate = true;
		if (m.instanceColor) m.instanceColor.needsUpdate = true;
	}
	const group = new THREE.Group();
	group.add(blobs, pines, broads, rocks, shrubs, oaks, willows);
	group.name = "riparian";
	return {
		group,
		// Skip the whole set when the camera is too high for any tree to be drawn.
		setUnsquash(v) {
			unsquash.value = v;
		},
		update(camera, groundBelow) {
			group.visible = camera.position.y - groundBelow < FADE_FAR;
		},
		counts,
		fade: [ FADE_NEAR, FADE_FAR ],
		// Where the trees stand (for deer at the forest edge).
		trees: () => placed,
		// For tests: lowest vegetation value under any placed tree.
		minVegetation: () => placed.reduce((a, p) => Math.min(a, p.veg), 1),
	};
}
