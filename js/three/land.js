// Extruded California built from the TopoJSON outline, with county lines on top.
export const LAND_H = 14;

function ringToPath(THREE, ring, project, PathType) {
	const shape = new PathType();
	// Rings are closed (last point repeats the first); drop the repeat for the triangulator.
	ring.slice(0, -1).forEach(([ lon, lat ], i) => {
		const [ x, z ] = project([ lon, lat ]);
		// Shape lives in XY; y = -z so that rotating by -90° about X puts it on the ground.
		if (i === 0) shape.moveTo(x, -z);
		else shape.lineTo(x, -z);
	});
	return shape;
}

export function createLand(THREE, data, project) {
	// Triangulate county by county: the merged state outline is one huge ring with
	// near-touching islands that the triangulator can mis-handle, leaving holes.
	const shapes = [];
	for (const f of data.counties.features) {
		const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [ f.geometry.coordinates ];
		for (const poly of polys) {
			const shape = ringToPath(THREE, poly[0], project, THREE.Shape);
			for (const hole of poly.slice(1)) shape.holes.push(ringToPath(THREE, hole, project, THREE.Path));
			shapes.push(shape);
		}
	}

	const geom = new THREE.ExtrudeGeometry(shapes, {
		depth: LAND_H,
		bevelEnabled: false,
		curveSegments: 1,
	});
	geom.rotateX(-Math.PI / 2);
	geom.computeVertexNormals();

	const top = new THREE.MeshStandardMaterial({ color: 0xe7dfcf, roughness: 0.92, metalness: 0 });
	const side = new THREE.MeshStandardMaterial({ color: 0xcbbfa8, roughness: 0.96, metalness: 0 });
	const mesh = new THREE.Mesh(geom, [ top, side ]);
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	// County borders as one LineSegments draw call.
	const pts = [];
	const y = LAND_H + 0.15;
	for (const line of data.countyMesh.coordinates) {
		for (let i = 1; i < line.length; i++) {
			const [ ax, az ] = project(line[i - 1]);
			const [ bx, bz ] = project(line[i]);
			pts.push(ax, y, az, bx, y, bz);
		}
	}
	const lineGeom = new THREE.BufferGeometry();
	lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
	const lineMat = new THREE.LineBasicMaterial({ color: 0xcfc4ae, transparent: true, opacity: 0.9 });
	const borders = new THREE.LineSegments(lineGeom, lineMat);

	const group = new THREE.Group();
	group.add(mesh, borders);

	return {
		group,
		setColors({ land, side: sideColor, county }) {
			top.color.set(land);
			side.color.set(sideColor);
			lineMat.color.set(county);
		},
	};
}
