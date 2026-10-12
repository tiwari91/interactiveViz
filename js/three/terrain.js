// Terrain: a displaced, vertex-coloured mesh over the ETOPO grid (wet and dry
// palettes blended by statewide storage), high-resolution basin patches around
// each reservoir, and the state border draped on top.
import { californiaMask, fbm, hash2 } from "./world.js";

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

function palette(THREE) {
	const c = (hex) => new THREE.Color(hex);
	return {
		beach: c(0xd9c9a3),
		valleyWet: c(0x7a8d58), fieldWet: c(0x8e9e66),
		valleyDry: c(0xbca77d), fieldDry: c(0xab9670),
		hillWet: c(0x7f8858), hillDry: c(0xab9068),
		forestWet: c(0x405a39), forestDry: c(0x55603a),
		sage: c(0x9a9b78),
		desert: c(0xcdb68c), desertDry: c(0xd6c095),
		rock: c(0x8b8378), rockDark: c(0x6c655d),
		snow: c(0xf3f4f5),
		mineral: c(0xbfae8c), mineralBand: c(0xa8977a), mineralWet: c(0x7d705c),
		cliff: c(0x7e7466),
		neighbour: c(0x948e83),
	};
}

// Desert share at a place: the Mojave and the Great Basin edge. The edges are wide and
// wobble with noise so they never draw a straight seam across the state; the southern
// coast (chaparral, not desert) keeps only a little of it.
function desertAt(lon, lat, nz = 0.5) {
	const w = (nz - 0.5) * 0.9;
	const mojave = smoothstep(-119.8, -117.6, lon + w) * (1 - smoothstep(35.9, 37.6, lat + w * 0.6));
	const coast = smoothstep(35.0, 34.2, lat + w * 0.4) * (1 - smoothstep(-117.4, -116.6, lon + w));
	const basin = smoothstep(-121.2, -120.4, lon) * smoothstep(40.2, 40.9, lat) * 0.6;
	return Math.min(1, mojave * (1 - 0.6 * coast) + basin);
}

// How wooded the ground is (0..1) at an elevation, slope and place: the same belts the
// terrain colours use, so trees only grow where the ground reads as vegetated.
export function vegetation(m, slopeY, lon, lat) {
	if (m < 5) return 0;
	const desert = desertAt(lon, lat);
	const belt = Math.max(0.55 * smoothstep(60, 300, m), smoothstep(500, 1000, m)) * (1 - smoothstep(2500, 2900, m));
	return belt * (1 - desert) * smoothstep(0.72, 0.86, slopeY);
}

// Colour for natural terrain; writes linear RGB into out (wet) and outDry.
function shadeTerrain(P, m, slopeY, lon, lat, nz, inCA, out, outDry) {
	const tmp = out;
	const dry = outDry;
	if (m <= 3 && inCA < 0.97) {
		tmp.copy(P.beach);
		dry.copy(P.beach);
	} else {
		// Patchwork of fields on the valley floor, plain ground elsewhere.
		const field = m < 160 ? hash2(Math.floor(lon * 45), Math.floor(lat * 45)) : 0.5;
		tmp.copy(P.valleyWet).lerp(P.fieldWet, field);
		dry.copy(P.valleyDry).lerp(P.fieldDry, field);
		const hill = smoothstep(150, 500, m + nz * 120);
		tmp.lerp(P.hillWet, hill);
		dry.lerp(P.hillDry, hill);
		const forest = smoothstep(800, 1300, m + nz * 260) * (1 - smoothstep(2600, 3000, m));
		tmp.lerp(P.forestWet, forest);
		dry.lerp(P.forestDry, forest);
		const d = desertAt(lon, lat, nz) * (1 - forest * 0.6);
		tmp.lerp(lat > 39.5 ? P.sage : P.desert, d);
		dry.lerp(lat > 39.5 ? P.sage : P.desertDry, d);
		const rocky = Math.max(smoothstep(0.93, 0.7, slopeY), smoothstep(2300, 2800, m));
		tmp.lerp(nz > 0.5 ? P.rock : P.rockDark, rocky * 0.85);
		dry.lerp(nz > 0.5 ? P.rock : P.rockDark, rocky * 0.85);
		tmp.lerp(P.snow, smoothstep(2850, 3150, m + nz * 200) * smoothstep(0.6, 0.85, slopeY));
		dry.lerp(P.snow, smoothstep(3300, 3500, m + nz * 200) * smoothstep(0.6, 0.85, slopeY));
	}
	if (inCA < 1) {
		const k = (1 - inCA) * 0.78;
		tmp.lerp(P.neighbour, k);
		dry.lerp(P.neighbour, k);
	}
}

// Tileable detail texture for close views (mipmapped, anisotropic): R fine grain, G medium
// blotches, B rock cracks, A grass tufts. Periodic value noise so it tiles without seams.
export function detailTexture(THREE, size = 256) {
	const per = (x, y, p, seed) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const tx = x - xi;
		const ty = y - yi;
		const sx = tx * tx * (3 - 2 * tx);
		const sy = ty * ty * (3 - 2 * ty);
		const h = (a, b) => hash2(((a % p) + p) % p + seed, ((b % p) + p) % p);
		return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
	};
	const oct = (u, v, base, n, seed) => {
		let val = 0;
		let amp = 0.5;
		let f = base;
		for (let i = 0; i < n; i++) {
			val += amp * per(u * f, v * f, f, seed + i * 17);
			f *= 2;
			amp *= 0.5;
		}
		return val / (1 - Math.pow(0.5, n));
	};
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			const fine = oct(u, v, 16, 4, 1);
			const blot = oct(u, v, 4, 4, 50);
			const ridge = 1 - Math.abs(oct(u, v, 8, 3, 90) * 2 - 1);
			const tuft = Math.pow(oct(u, v, 32, 2, 130), 2.2);
			const i = (y * size + x) * 4;
			data[i] = fine * 255;
			data[i + 1] = blot * 255;
			data[i + 2] = Math.pow(ridge, 3) * 255;
			data[i + 3] = tuft * 255;
		}
	}
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

function material(THREE, uniforms) {
	const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uDry = uniforms.uDry;
		shader.uniforms.uDetail = uniforms.uDetail;
		shader.uniforms.uNight = uniforms.uNight;
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec3 colorDry;\nuniform float uDry;\nvarying vec3 vWPos;\nvarying vec3 vWN;")
			.replace("#include <color_vertex>", "#include <color_vertex>\n\tvColor.rgb = mix(color.rgb, colorDry, uDry);")
			.replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n\tvWN = normalize(mat3(modelMatrix) * objectNormal);")
			.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n\tvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
		// Close-up detail: grass grain and tufts on gentle ground, cracked rock on steep ground,
		// from a mipmapped detail texture at two scales, plus matching bumps. Fades with distance.
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>
varying vec3 vWPos;
varying vec3 vWN;
uniform sampler2D uDetail;
uniform float uNight;
float gNear;
float gRock;
vec4 gD1;`)
			.replace("#include <color_fragment>", `#include <color_fragment>
	{
		float dist = length(cameraPosition - vWPos);
		gNear = 1.0 - smoothstep(70.0, 520.0, dist);
		gD1 = texture2D(uDetail, vWPos.xz * 0.32);
		vec4 d2 = texture2D(uDetail, vWPos.xz * 0.055 + 0.37);
		float slope = 1.0 - normalize(vWN).y;
		vec3 c = diffuseColor.rgb;
		float lum = dot(c, vec3(0.3, 0.59, 0.11));
		float green = clamp((c.g - max(c.r, c.b)) * 10.0, 0.0, 1.0);
		gRock = smoothstep(0.14, 0.34, slope + (d2.g - 0.5) * 0.18) * (1.0 - step(0.8, lum));
		// Large-scale mottling everywhere, so close ground is never a flat wash.
		vec4 d3 = texture2D(uDetail, vWPos.xz * 0.011 + 0.71);
		float mott = mix(0.74, 1.22, d2.g) * mix(0.82, 1.12, gD1.r) * mix(0.8, 1.15, smoothstep(0.25, 0.75, d3.g));
		vec3 ground = c * mott;
		// Vegetated ground: darker tufts and lighter dry blades.
		ground = mix(ground, ground * vec3(0.62, 0.74, 0.55), smoothstep(0.08, 0.5, gD1.a) * (0.35 + 0.65 * green));
		ground = mix(ground, ground * vec3(1.12, 1.08, 0.92), smoothstep(0.62, 0.9, gD1.r) * green * 0.5);
		// Rock: greyer, cracked, with lighter weathered faces.
		vec3 rockC = mix(vec3(lum) * vec3(1.02, 0.98, 0.93), c, 0.45) * mix(0.78, 1.16, gD1.r);
		rockC *= 1.0 - gD1.b * 0.45;
		ground = mix(ground, rockC, gRock * 0.75);
		diffuseColor.rgb = mix(c, ground, gNear);
	}`)
			.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
	if (uNight > 0.0) {
		// Moonlit rims: slopes facing away from the viewer catch a cool edge light, so ridges
		// read against the valleys behind them; valley floors sink a little darker.
		vec3 V = normalize(cameraPosition - vWPos);
		vec3 N = normalize(vWN);
		float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
		float hiGround = smoothstep(0.0, 40.0, vWPos.y);
		totalEmissiveRadiance += uNight * vec3(0.07, 0.09, 0.14) * (rim * 0.9 + hiGround * 0.25) * diffuseColor.rgb * 3.0;
	}`)
			.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
	if (gNear > 0.0) {
		float e = 1.0 / 256.0;
		vec2 uv = vWPos.xz * 0.32;
		float h0 = gD1.r + gD1.b * gRock;
		vec4 tx = texture2D(uDetail, uv + vec2(e, 0.0));
		vec4 tz = texture2D(uDetail, uv + vec2(0.0, e));
		vec2 g = vec2(tx.r + tx.b * gRock - h0, tz.r + tz.b * gRock - h0) * (5.0 + 6.0 * gRock);
		normal = normalize(normal - (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz * gNear);
	}`);
	};
	return mat;
}

export function createTerrain(THREE, data, world, basins, quality) {
	const P = palette(THREE);
	const { rows, cols, north, west } = world.elev;
	const { mask, soft } = californiaMask(data, world.elev);
	const n = rows * cols;
	const pos = new Float32Array(n * 3);
	const meta = new Float32Array(n * 3); // metres, lon, lat
	for (let r = 0; r < rows; r++) {
		const lat = north - r * world.dlat;
		for (let c = 0; c < cols; c++) {
			const lon = west + c * world.dlon;
			const i = r * cols + c;
			const m = world.elev.data[i];
			const [ x, z ] = world.project([ lon, lat ]);
			let y = world.toY(m);
			if (m <= 0 && mask[i] > 0.5) y = 0.3; // inland basins below sea level stay dry land
			const s = basins.surfaceAt(x, z);
			if (s && s.h < y) y = s.h - 0.8 * s.w;
			pos.set([ x, y, z ], i * 3);
			meta.set([ m, lon, lat ], i * 3);
		}
	}
	// Skip open-ocean triangles: the ocean plane is drawn first without depth, so
	// any terrain drawn later (including lake beds below sea level) covers it.
	const sea = (i) => world.elev.data[i] <= 0 && mask[i] < 0.5;
	const index = new Uint32Array((rows - 1) * (cols - 1) * 6);
	let k = 0;
	for (let r = 0; r < rows - 1; r++) {
		for (let c = 0; c < cols - 1; c++) {
			const a = r * cols + c;
			const b = a + 1;
			const d = a + cols;
			const e = d + 1;
			if (!(sea(a) && sea(d) && sea(b))) {
				index[k++] = a; index[k++] = d; index[k++] = b;
			}
			if (!(sea(b) && sea(d) && sea(e))) {
				index[k++] = b; index[k++] = d; index[k++] = e;
			}
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	geom.setIndex(new THREE.BufferAttribute(index.subarray(0, k), 1));
	geom.computeVertexNormals();
	const nrm = geom.attributes.normal.array;
	const col = new Float32Array(n * 3);
	const colDry = new Float32Array(n * 3);
	const a = new THREE.Color();
	const b = new THREE.Color();
	for (let i = 0; i < n; i++) {
		const [ m, lon, lat ] = [ meta[i * 3], meta[i * 3 + 1], meta[i * 3 + 2] ];
		const nz = fbm(lon * 9, lat * 9, 3);
		shadeTerrain(P, mask[i] > 0.5 && m <= 0 ? 10 : m, nrm[i * 3 + 1], lon, lat, nz, soft[i], a, b);
		col.set([ a.r, a.g, a.b ], i * 3);
		colDry.set([ b.r, b.g, b.b ], i * 3);
	}
	geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
	geom.setAttribute("colorDry", new THREE.BufferAttribute(colDry, 3));

	const detail = detailTexture(THREE);
	const uniforms = { uDry: { value: 0.4 }, uDetail: { value: detail }, uNight: { value: 0 } };
	const mat = material(THREE, uniforms);
	const mesh = new THREE.Mesh(geom, mat);
	mesh.receiveShadow = true;
	mesh.castShadow = quality === "high";

	const patches = new THREE.Mesh(buildPatches(THREE, P, world, basins, quality), material(THREE, uniforms));
	patches.material.polygonOffset = true;
	patches.material.polygonOffsetFactor = -2;
	patches.material.polygonOffsetUnits = -2;
	patches.receiveShadow = true;
	patches.castShadow = quality === "high";

	const border = buildBorder(THREE, data, world);
	const surround = new THREE.Mesh(buildSurround(THREE, P, world), mat);
	surround.receiveShadow = true;

	const group = new THREE.Group();
	group.add(surround, mesh, patches, border);
	return {
		group,
		detail,
		setNight(v) {
			uniforms.uNight.value = v;
		},
		setDryness(v) {
			uniforms.uDry.value = v;
		},
		get dryness() {
			return uniforms.uDry.value;
		},
		setBorderColor(hex, opacity) {
			border.material.color.set(hex);
			border.material.opacity = opacity;
		},
	};
}

function buildPatches(THREE, P, world, basins, quality) {
	const res = quality === "high" ? 84 : 46;
	const positions = [];
	const colors = [];
	const colorsDry = [];
	const indices = [];
	const a = new THREE.Color();
	const b = new THREE.Color();
	let base = 0;
	for (const bs of basins.basins) {
		const scale = Math.max(0.55, Math.min(1, bs.Lu / 14));
		const nu = Math.round(res * scale);
		const nv = Math.round(res * scale * 0.85);
		const ys = new Float32Array((nu + 1) * (nv + 1));
		const zones = [];
		const info = [];
		for (let i = 0; i <= nu; i++) {
			for (let j = 0; j <= nv; j++) {
				const u = bs.extent.u[0] + ((bs.extent.u[1] - bs.extent.u[0]) * i) / nu;
				const v = bs.extent.v[0] + ((bs.extent.v[1] - bs.extent.v[0]) * j) / nv;
				const [ x, z ] = bs.toWorld(u, v);
				const s = basins.surfaceAt(x, z);
				const [ lon, lat ] = world.unproject(x, z);
				const m = world.metresAt(lon, lat);
				const y = s ? s.h : world.groundY(x, z);
				ys[i * (nv + 1) + j] = y;
				positions.push(x, y, z);
				zones.push(s ? s.zone : "outside");
				info.push([ m, lon, lat, s ]);
			}
		}
		for (let i = 0; i < nu; i++) {
			for (let j = 0; j < nv; j++) {
				const p0 = base + i * (nv + 1) + j;
				const p1 = p0 + 1;
				const p2 = p0 + nv + 1;
				const p3 = p2 + 1;
				// Local u runs along eu and v along ev; pick the winding that faces up.
				const flip = bs.eu[0] * bs.ev[1] - bs.eu[1] * bs.ev[0] > 0;
				if (flip) indices.push(p0, p1, p2, p1, p3, p2);
				else indices.push(p0, p2, p1, p1, p2, p3);
			}
		}
		// Slope from neighbouring heights (cheap normal.y estimate).
		const du = (bs.extent.u[1] - bs.extent.u[0]) / nu;
		const dv = (bs.extent.v[1] - bs.extent.v[0]) / nv;
		for (let i = 0; i <= nu; i++) {
			for (let j = 0; j <= nv; j++) {
				const idx = i * (nv + 1) + j;
				const gy = (ys[Math.min(nu, i + 1) * (nv + 1) + j] - ys[Math.max(0, i - 1) * (nv + 1) + j]) / (2 * du);
				const gx = (ys[i * (nv + 1) + Math.min(nv, j + 1)] - ys[i * (nv + 1) + Math.max(0, j - 1)]) / (2 * dv);
				const slopeY = 1 / Math.sqrt(1 + gx * gx + gy * gy);
				const [ m, lon, lat, s ] = info[idx];
				const nz = fbm(lon * 9, lat * 9, 3);
				shadeTerrain(P, m, slopeY, lon, lat, nz, 1, a, b);
				const zone = zones[idx];
				if (s && zone !== "outside") {
					const y = ys[idx];
					const own = basins.byId.get(s.basinId) ?? bs;
					if (zone === "bowl") {
						// Bathtub ring: pale mineral banks with faint level lines; darker silt lower down.
						const depth = (own.P - y) / own.D;
						const band = Math.abs(Math.sin(y * 9.0)) > 0.86 ? 1 : 0;
						a.copy(P.mineral).lerp(P.mineralBand, band * 0.6).lerp(P.mineralWet, smoothstep(0.45, 1, depth) * 0.7);
						b.copy(a);
					} else {
						const cliff = smoothstep(0.85, 0.55, slopeY) * s.w;
						a.lerp(P.cliff, cliff);
						b.lerp(P.cliff, cliff);
					}
				}
				colors.push(a.r, a.g, a.b);
				colorsDry.push(b.r, b.g, b.b);
			}
		}
		base += (nu + 1) * (nv + 1);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
	g.setAttribute("colorDry", new THREE.Float32BufferAttribute(colorsDry, 3));
	g.setIndex(indices);
	g.computeVertexNormals();
	return g;
}

// Coarse terrain of the wider region, under and around the detailed grid.
function buildSurround(THREE, P, world) {
	const g = world.elev.surround;
	const inner = world.elev;
	const dlat = (g.north - g.south) / (g.rows - 1);
	const dlon = (g.east - g.west) / (g.cols - 1);
	const n = g.rows * g.cols;
	const pos = new Float32Array(n * 3);
	const col = new Float32Array(n * 3);
	const a = new THREE.Color();
	const b = new THREE.Color();
	const margin = 1.5;
	const inside = new Uint8Array(n);
	for (let r = 0; r < g.rows; r++) {
		const lat = g.north - r * dlat;
		for (let c = 0; c < g.cols; c++) {
			const lon = g.west + c * dlon;
			const i = r * g.cols + c;
			const m = g.data[i];
			const [ x, z ] = world.project([ lon, lat ]);
			pos.set([ x, world.toY(m) - 0.35, z ], i * 3);
			shadeTerrain(P, m, 0.95, lon, lat, fbm(lon * 4, lat * 4, 2), 0, a, b);
			col.set([ a.r, a.g, a.b ], i * 3);
			inside[i] = lat < inner.north - margin * dlat && lat > inner.south + margin * dlat
				&& lon > inner.west + margin * dlon && lon < inner.east - margin * dlon ? 1 : 0;
		}
	}
	const sea = (i) => g.data[i] <= 0;
	const index = [];
	for (let r = 0; r < g.rows - 1; r++) {
		for (let c = 0; c < g.cols - 1; c++) {
			const p0 = r * g.cols + c;
			const p1 = p0 + 1;
			const p2 = p0 + g.cols;
			const p3 = p2 + 1;
			if (inside[p0] && inside[p1] && inside[p2] && inside[p3]) continue;
			if (!(sea(p0) && sea(p2) && sea(p1))) index.push(p0, p2, p1);
			if (!(sea(p1) && sea(p2) && sea(p3))) index.push(p1, p2, p3);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
	geom.setAttribute("colorDry", new THREE.BufferAttribute(col.slice(), 3));
	geom.setIndex(index);
	geom.computeVertexNormals();
	return geom;
}

function buildBorder(THREE, data, world) {
	const pts = [];
	const polys = data.outline.type === "MultiPolygon" ? data.outline.coordinates : [ data.outline.coordinates ];
	for (const poly of polys) {
		const ring = poly[0];
		for (let i = 1; i < ring.length; i++) {
			const [ ax, az ] = world.project(ring[i - 1]);
			const [ bx, bz ] = world.project(ring[i]);
			const ay = Math.max(0.3, world.groundY(ax, az)) + 0.5;
			const by = Math.max(0.3, world.groundY(bx, bz)) + 0.5;
			pts.push(ax, ay, az, bx, by, bz);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
	return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
}
