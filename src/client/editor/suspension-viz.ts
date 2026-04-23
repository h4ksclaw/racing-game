/**
 * Suspension travel visualization — shows min/max wheel positions + real-time preview.
 */
import * as THREE from "three";
import type { PhysicsOverrides } from "./bake-export.js";
import { getScene } from "./editor-main.js";
import type { MarkerData } from "./marker-tool.js";

const WHEEL_TYPES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;
let vizGroup: THREE.Group | null = null;
let previewGroup: THREE.Group | null = null;
const originalWheelYs: Map<string, number> = new Map();
let compressionPercent = 50;

export function showSuspensionRange(_model: THREE.Group, markers: MarkerData[], overrides: PhysicsOverrides): void {
	hideSuspensionRange();
	vizGroup = new THREE.Group();
	vizGroup.name = "__suspension_viz__";

	const travel = overrides.maxSuspensionTravel ?? 0.3;

	for (const wt of WHEEL_TYPES) {
		const m = markers.find((mk) => mk.type === wt);
		if (!m) continue;
		const pos = m.position;
		originalWheelYs.set(wt, pos.y);

		// Current position — green dot
		const currentDot = makeDot(pos, 0.04, 0x00ff88);
		vizGroup.add(currentDot);

		// Max up — blue dot
		const upPos = pos.clone();
		upPos.y += travel;
		vizGroup.add(makeDot(upPos, 0.03, 0x4a9eff));

		// Max down — red dot
		const downPos = pos.clone();
		downPos.y -= travel;
		vizGroup.add(makeDot(downPos, 0.03, 0xff4444));

		// Vertical line connecting min/max
		const lineGeo = new THREE.BufferGeometry().setFromPoints([upPos, downPos]);
		const lineMat = new THREE.LineBasicMaterial({
			color: 0xffffff,
			depthTest: false,
			transparent: true,
			opacity: 0.4,
		});
		const line = new THREE.Line(lineGeo, lineMat);
		line.renderOrder = 999;
		vizGroup.add(line);

		// Suspension line from wheel center to body attachment (rest length above wheel)
		const bodyAttach = pos.clone();
		bodyAttach.y += overrides.suspensionRestLength ?? 0.3;
		const suspLineGeo = new THREE.BufferGeometry().setFromPoints([pos, bodyAttach]);
		const suspLineMat = new THREE.LineDashedMaterial({
			color: 0xffff00,
			depthTest: false,
			transparent: true,
			opacity: 0.6,
			dashSize: 0.03,
			gapSize: 0.02,
		});
		const suspLine = new THREE.Line(suspLineGeo, suspLineMat);
		suspLine.computeLineDistances();
		suspLine.renderOrder = 998;
		vizGroup.add(suspLine);

		// Body attachment dot
		vizGroup.add(makeDot(bodyAttach, 0.025, 0xffff00));
	}

	getScene().add(vizGroup);
	updatePreview(markers, overrides);
}

export function hideSuspensionRange(): void {
	if (vizGroup) {
		disposeGroup(vizGroup);
		vizGroup = null;
	}
	if (previewGroup) {
		disposeGroup(previewGroup);
		previewGroup = null;
	}
}

/**
 * Update suspension preview based on compression percent (0 = full droop, 100 = full compression).
 * Moves wheel marker meshes up/down and shifts car body vertically.
 */
export function updatePreview(markers: MarkerData[], overrides: PhysicsOverrides): void {
	// Remove old preview
	if (previewGroup) {
		disposeGroup(previewGroup);
		previewGroup = null;
	}

	const travel = overrides.maxSuspensionTravel ?? 0.3;
	// 0% = full droop (wheels down by travel), 100% = full compression (wheels up by travel)
	// At 50%, wheels at rest
	const offset = (compressionPercent / 100 - 0.5) * 2 * travel;

	for (const wt of WHEEL_TYPES) {
		const m = markers.find((mk) => mk.type === wt);
		if (!m) continue;
		const baseY = originalWheelYs.get(wt) ?? m.position.y;

		// Move the actual marker mesh
		m.mesh.position.y = baseY + offset;

		// Add preview indicator dot (yellow, shows current preview position)
		if (!previewGroup) {
			previewGroup = new THREE.Group();
			previewGroup.name = "__susp_preview__";
		}

		const previewPos = new THREE.Vector3(m.position.x, baseY + offset, m.position.z);
		const dot = makeDot(previewPos, 0.035, 0xffaa00);
		previewGroup.add(dot);
	}

	if (previewGroup) getScene().add(previewGroup);
}

/**
 * Set the compression percentage for the preview slider.
 */
export function setCompressionPercent(percent: number): void {
	compressionPercent = percent;
}

/**
 * Get the current compression percentage.
 */
export function getCompressionPercent(): number {
	return compressionPercent;
}

function makeDot(position: THREE.Vector3, radius: number, color: number): THREE.Mesh {
	const geo = new THREE.SphereGeometry(radius, 8, 8);
	const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
	const dot = new THREE.Mesh(geo, mat);
	dot.position.copy(position);
	dot.renderOrder = 1000;
	return dot;
}

function disposeGroup(group: THREE.Group): void {
	getScene().remove(group);
	group.traverse((child) => {
		if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
		const mat = (child as THREE.Mesh).material;
		if (mat) {
			if (Array.isArray(mat)) for (const m of mat) m.dispose();
			else mat.dispose();
		}
	});
}
