// Gauge links: the 2016 dataset relates each reservoir to river gauges in its
// basin. These are data relationships, not rivers, so they are drawn as thin
// dashed arcs floating above the terrain with a small station marker, hidden by
// default and shown for the hovered/selected reservoir or when toggled on.
export function createGaugeLinks(THREE, data, world, basins) {
	const group = new THREE.Group();
	const ground = (x, z) => {
		const s = basins.surfaceAt(x, z);
		return Math.max(0.3, s ? s.h : world.groundY(x, z));
	};
	const mat = new THREE.LineDashedMaterial({ color: 0x5d6b7a, dashSize: 1.1, gapSize: 0.9, transparent: true, opacity: 0.9, depthWrite: false });
	const lines = data.links.map((l) => {
		const [ ax, az ] = world.project([ l.gauge.lon, l.gauge.lat ]);
		const [ bx, bz ] = world.project([ l.reservoir.lon, l.reservoir.lat ]);
		const len = Math.hypot(bx - ax, bz - az);
		const n = Math.max(12, Math.round(len / 2));
		// Float a little above the terrain (clearing nearby ridges) with a gentle arc.
		const gs = [];
		for (let i = 0; i <= n; i++) gs.push(ground(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n));
		const ya = gs[0] + 1.8;
		const yb = gs[n] + 1.8;
		const pts = [];
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			let near = 0;
			for (let j = Math.max(0, i - 3); j <= Math.min(n, i + 3); j++) near = Math.max(near, gs[j]);
			const y = Math.max(near + 1.8, ya + (yb - ya) * t + Math.sin(Math.PI * t) * 2.5);
			pts.push(new THREE.Vector3(ax + (bx - ax) * t, y, az + (bz - az) * t));
		}
		const geom = new THREE.BufferGeometry().setFromPoints(pts);
		const line = new THREE.Line(geom, mat);
		line.computeLineDistances();
		line.visible = false;
		line.renderOrder = 7;
		line.userData = { reservoir: l.reservoir.id, gauge: l.gauge.id };
		group.add(line);
		return line;
	});

	// Station markers: a small post with a disc, one per gauge.
	const post = new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6);
	post.translate(0, 0.8, 0);
	const markerMat = new THREE.MeshStandardMaterial({ color: 0x5d6b7a, roughness: 0.5 });
	const gauges = new THREE.InstancedMesh(post, markerMat, data.gauges.length);
	const head = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.4 }), data.gauges.length);
	const m = new THREE.Matrix4();
	data.gauges.forEach((g, i) => {
		const [ x, z ] = world.project([ g.lon, g.lat ]);
		const y = ground(x, z);
		m.makeTranslation(x, y, z);
		gauges.setMatrixAt(i, m);
		m.makeTranslation(x, y + 1.65, z);
		head.setMatrixAt(i, m);
	});
	gauges.visible = false;
	head.visible = false;
	group.add(gauges, head);

	let showAll = false;
	let active = null;
	function sync() {
		const used = new Set();
		for (const ln of lines) {
			ln.visible = showAll || ln.userData.reservoir === active;
			if (ln.visible) used.add(ln.userData.gauge);
		}
		const any = used.size > 0;
		gauges.visible = any;
		head.visible = any;
		// Hide markers of gauges not in use by scaling them away.
		data.gauges.forEach((g, i) => {
			const [ x, z ] = world.project([ g.lon, g.lat ]);
			const y = ground(x, z);
			const k = used.has(g.id) ? 1 : 0.0001;
			m.makeScale(k, k, k).setPosition(x, y, z);
			gauges.setMatrixAt(i, m);
			m.makeScale(k, k, k).setPosition(x, y + 1.65, z);
			head.setMatrixAt(i, m);
		});
		gauges.instanceMatrix.needsUpdate = true;
		head.instanceMatrix.needsUpdate = true;
	}

	return {
		group,
		gauges,
		lines,
		setShowAll(v) {
			showAll = v;
			sync();
		},
		setActive(id) {
			if (id === active) return;
			active = id;
			sync();
		},
		get showAll() {
			return showAll;
		},
		visibleCount: () => lines.filter((l) => l.visible).length,
		setTheme(night) {
			mat.color.set(night ? 0xc9d4e2 : 0x56606b);
			markerMat.color.set(night ? 0xc9d4e2 : 0x56606b);
		},
	};
}
