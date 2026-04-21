/**
 * Bounding box dimension overlay for the car editor.
 */
import * as THREE from "three";
import { getCurrentModel, getScene, isShowingDims } from "./editor-main.js";

const dimsGroup = new THREE.Group();
dimsGroup.visible = false;
getScene().add(dimsGroup);

let ghostBox: THREE.Mesh | null = null;
let dimLabels: THREE.Sprite[] = [];

function createTextSprite(text: string, color: string): THREE.Sprite {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = color;
	ctx.font = "bold 32px JetBrains Mono, monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 128, 32);

	const texture = new THREE.CanvasTexture(canvas);
	const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(1.5, 0.4, 1);
	return sprite;
}

function clearDims() {
	while (dimsGroup.children.length > 0) {
		const child = dimsGroup.children[0];
		if (child instanceof THREE.Mesh) child.geometry.dispose();
		if (child instanceof THREE.Sprite) {
			const mat = (child as THREE.Sprite).material as THREE.SpriteMaterial;
			mat.map?.dispose();
			mat.dispose();
		}
		dimsGroup.remove(child);
	}
	dimLabels = [];
	ghostBox = null;
}

/**
 * Update the dimension overlay to show the current model's bounding box.
 */
export function updateDimensions() {
	if (!isShowingDims()) {
		dimsGroup.visible = false;
		return;
	}

	const model = getCurrentModel();
	if (!model) {
		dimsGroup.visible = false;
		return;
	}

	dimsGroup.visible = true;
	clearDims();

	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());

	// Edge wireframe box
	const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
	const edges = new THREE.EdgesGeometry(boxGeo);
	const lineMat = new THREE.LineBasicMaterial({ color: 0x4a9eff, depthTest: false });
	const wireframe = new THREE.LineSegments(edges, lineMat);
	wireframe.position.copy(center);
	dimsGroup.add(wireframe);

	// Dimension labels
	const fmt = (v: number) => `${v.toFixed(2)}m`;
	dimLabels.push(createTextSprite(fmt(size.x), "#4a9eff"));
	dimLabels[0].position.set(center.x, box.min.y - 0.15, center.z);
	dimsGroup.add(dimLabels[0]);

	dimLabels.push(createTextSprite(fmt(size.y), "#4a9eff"));
	dimLabels[1].position.set(box.max.x + 0.3, center.y, center.z);
	dimsGroup.add(dimLabels[1]);

	dimLabels.push(createTextSprite(fmt(size.z), "#4a9eff"));
	dimLabels[2].position.set(center.x, center.y, box.max.z + 0.3);
	dimsGroup.add(dimLabels[2]);
}

/**
 * Show ghost overlay of expected dimensions for comparison.
 */
export function showExpectedGhost(lengthM: number, widthM: number, heightM: number) {
	const model = getCurrentModel();
	if (!model) return;

	const ghostGeo = new THREE.BoxGeometry(widthM, heightM, lengthM);
	const ghostMat = new THREE.MeshBasicMaterial({
		color: 0x4aff8b,
		wireframe: true,
		transparent: true,
		opacity: 0.3,
		depthTest: false,
	});

	if (ghostBox) {
		ghostBox.geometry.dispose();
		(ghostBox.material as THREE.Material).dispose();
		dimsGroup.remove(ghostBox);
	}

	ghostBox = new THREE.Mesh(ghostGeo, ghostMat);
	// Position ghost at same center as model
	const box = new THREE.Box3().setFromObject(model);
	const center = box.getCenter(new THREE.Vector3());
	ghostBox.position.copy(center);
	dimsGroup.add(ghostBox);
}

export function clearGhost() {
	if (ghostBox) {
		ghostBox.geometry.dispose();
		(ghostBox.material as THREE.Material).dispose();
		dimsGroup.remove(ghostBox);
		ghostBox = null;
	}
}

/**
 * Get current model dimensions in meters.
 */
export function getModelDimensions(): { length: number; width: number; height: number } | null {
	const model = getCurrentModel();
	if (!model) return null;
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	return { length: size.z, width: size.x, height: size.y };
}
