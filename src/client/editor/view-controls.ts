/**
 * Preset camera views — Blender-like view switching.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewPreset = "front" | "back" | "top" | "bottom" | "left" | "right";

/**
 * Set camera to a preset view, looking at the target point.
 * Assumes car faces +Z direction.
 */
export function setViewPreset(
	view: ViewPreset,
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	target: THREE.Vector3,
): void {
	const dist = camera.position.distanceTo(controls.target) || 5;
	const centerY = target.y + dist * 0.2;

	const positions: Record<ViewPreset, THREE.Vector3> = {
		front: new THREE.Vector3(0, centerY, target.z + dist),
		back: new THREE.Vector3(0, centerY, target.z - dist),
		top: new THREE.Vector3(target.x, target.y + dist, target.z),
		bottom: new THREE.Vector3(target.x, target.y - dist, target.z),
		left: new THREE.Vector3(target.x - dist, centerY, target.z),
		right: new THREE.Vector3(target.x + dist, centerY, target.z),
	};

	camera.position.copy(positions[view]);
	controls.target.copy(target);
	controls.update();
}

/**
 * Fit camera to see the entire model in frame.
 */
export function fitCameraToModel(camera: THREE.PerspectiveCamera, controls: OrbitControls, model: THREE.Group): void {
	const box = new THREE.Box3().setFromObject(model);
	const center = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	const dist = maxDim * 1.8;

	camera.position.set(center.x + dist * 0.5, center.y + dist * 0.4, center.z + dist * 0.8);
	controls.target.copy(center);
	controls.update();
}
