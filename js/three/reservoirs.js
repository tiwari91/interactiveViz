// Reservoirs as glass columns: height = capacity, inner water level = storage.
import { LAND_H } from "./land.js";

const MAX_H = 170;
const MIN_H = 4;

export function createReservoirs(THREE, data, project) {
	const maxCap = Math.max(...data.reservoirs.map((r) => r.capacity));
	const group = new THREE.Group();
	const glassGeom = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
	glassGeom.translate(0, 0.5, 0);
	const waterGeom = new THREE.CylinderGeometry(0.84, 0.84, 1, 40);
	waterGeom.translate(0, 0.5, 0);
	const rimGeom = new THREE.TorusGeometry(1, 0.06, 6, 40);
	rimGeom.rotateX(Math.PI / 2);
	const baseGeom = new THREE.CircleGeometry(1.25, 40);
	baseGeom.rotateX(-Math.PI / 2);

	const glassMat = new THREE.MeshStandardMaterial({
		color: 0x9fb4c8, transparent: true, opacity: 0.22, roughness: 0.15, metalness: 0.1,
		side: THREE.DoubleSide, depthWrite: false,
	});
	const glassActive = glassMat.clone();
	glassActive.opacity = 0.42;
	const rimMat = new THREE.MeshBasicMaterial({ color: 0x6b7d90, transparent: true, opacity: 0.8 });
	const rimActive = new THREE.MeshBasicMaterial({ color: 0x1f2328 });
	const baseMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false });

	const items = data.reservoirs.map((r) => {
		const [ x, z ] = project([ r.lon, r.lat ]);
		const height = MIN_H + (r.capacity / maxCap) * (MAX_H - MIN_H);
		const radius = 3 + 8 * Math.sqrt(r.capacity / maxCap);
		const node = new THREE.Group();
		node.position.set(x, LAND_H, z);

		const glass = new THREE.Mesh(glassGeom, glassMat);
		glass.scale.set(radius, height, radius);
		glass.renderOrder = 2;
		glass.userData.reservoir = r;

		const waterMat = new THREE.MeshStandardMaterial({ color: 0x5aa3cf, roughness: 0.3, metalness: 0.05, emissive: 0x000000 });
		const water = new THREE.Mesh(waterGeom, waterMat);
		water.scale.set(radius, 0.01, radius);
		water.castShadow = true;
		water.visible = r.hasData;

		const rim = new THREE.Mesh(rimGeom, rimMat);
		rim.scale.set(radius, radius, radius);
		rim.position.y = height;

		const base = new THREE.Mesh(baseGeom, baseMat);
		base.scale.set(radius, 1, radius);
		base.position.y = 0.05;

		node.add(base, water, glass, rim);
		group.add(node);
		return { r, node, glass, water, rim, height, radius, level: 0, target: 0, color: new THREE.Color(), targetColor: new THREE.Color() };
	});

	const byId = new Map(items.map((it) => [ it.r.id, it ]));

	return {
		group,
		items,
		byId,
		pickables: items.map((it) => it.glass),
		setTargets(dateIndex, colorFor, instant = false) {
			for (const it of items) {
				const v = it.r.series[dateIndex];
				const pct = v === null ? 0 : Math.min(1, v / it.r.capacity);
				it.target = Math.max(0.01, pct * it.height);
				it.targetColor.set(colorFor(v === null ? null : v / it.r.capacity));
				it.water.visible = v !== null;
				if (instant) {
					it.level = it.target;
					it.color.copy(it.targetColor);
				}
			}
		},
		// Ease water levels and colours toward their targets; returns true while moving.
		tick(dt) {
			const k = 1 - Math.exp(-dt * 7);
			let moving = false;
			for (const it of items) {
				const d = it.target - it.level;
				if (Math.abs(d) > 0.02) {
					it.level += d * k;
					moving = true;
				} else it.level = it.target;
				it.color.lerp(it.targetColor, k);
				it.water.scale.y = it.level;
				it.water.material.color.copy(it.color);
			}
			return moving;
		},
		setActive(id) {
			for (const it of items) {
				const on = it.r.id === id;
				it.glass.material = on ? glassActive : glassMat;
				it.rim.material = on ? rimActive : rimMat;
			}
		},
		setColors({ glass, ink }) {
			glassMat.color.set(glass);
			glassActive.color.set(glass);
			rimMat.color.set(glass);
			rimActive.color.set(ink);
		},
		topOf(id, out) {
			const it = byId.get(id);
			return out.set(it.node.position.x, it.node.position.y + it.height + 4, it.node.position.z);
		},
	};
}
