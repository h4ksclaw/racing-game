/**
 * Suspension travel visualization — shows min/max wheel positions.
 */
import * as THREE from "three";
import type { PhysicsOverrides } from "./bake-export.js";
import { getScene } from "./editor-main.js";
import type { MarkerData } from "./marker-tool.js";

const WHEEL_TYPES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;
let vizGroup: THREE.Group | null = null;

export function showSuspensionRange(_model: THREE.Group, markers: MarkerData[], overrides: PhysicsOverrides): void {
	hideSuspensionRange();
	vizGroup = new THREE.Group();
	vizGroup.name = "__suspension_viz__";

	const travel = overrides.maxSuspensionTravel ?? 0.3;

	for (const wt of WHEEL_TYPES) {
		const m = markers.find((mk) => mk.type === wt);
		if (!m) continue;

		const pos = m.position;

		// Current position — green dot
		const currentGeo = new THREE.SphereGeometry(0.04, 8, 8);
		const currentMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, depthTest: false });
		const currentDot = new THREE.Mesh(currentGeo, currentMat);
		currentDot.position.copy(pos);
		currentDot.renderOrder = 1000;
		vizGroup.add(currentDot);

		// Max up — blue dot
		const upPos = pos.clone();
		upPos.y += travel;
		const upGeo = new THREE.SphereGeometry(0.03, 8, 8);
		const upMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff, depthTest: false });
		const upDot = new THREE.Mesh(upGeo, upMat);
		upDot.position.copy(upPos);
		upDot.renderOrder = 1000;
		vizGroup.add(upDot);

		// Max down — red dot
		const downPos = pos.clone();
		downPos.y -= travel;
		const downGeo = new THREE.SphereGeometry(0.03, 8, 8);
		const downMat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false });
		const downDot = new THREE.Mesh(downGeo, downMat);
		downDot.position.copy(downPos);
		downDot.renderOrder = 1000;
		vizGroup.add(downDot);

		// Vertical line connecting min/max
		const lineGeo = new THREE.BufferGeometry().setFromPoints([upPos, downPos]);
		const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.4 });
		const line = new THREE.Line(lineGeo, lineMat);
		line.renderOrder = 999;
		vizGroup.add(line);
	}

	getScene().add(vizGroup);
}

export function hideSuspensionRange(): void {
	if (!vizGroup) return;
	getScene().remove(vizGroup);
	vizGroup.traverse((child) => {
		if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
		if ((child as THREE.Mesh).material) {
			const mat = (child as THREE.Mesh).material;
			if (Array.isArray(mat)) mat.forEach((m) => void m.dispose());
			else mat.dispose();
		}
	});
	vizGroup = null;
}
