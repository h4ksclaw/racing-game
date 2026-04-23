/**
 * Object selection and management for GLB model objects.
 */
import type * as THREE from "three";

export interface ObjectInfo {
	uuid: string;
	name: string;
	type: string; // 'mesh', 'group', 'empty'
	vertexCount: number;
	faceCount: number;
	visible: boolean;
	markedAs: string | null; // 'wheel_FL', 'wheel_FR', 'headlight', 'taillight', 'brake_disc_FL', etc., null
}

/** Traverse the model and return metadata for all objects. */
export function getModelObjects(model: THREE.Group): ObjectInfo[] {
	const results: ObjectInfo[] = [];
	model.traverse((child) => {
		let type = "group";
		let vertexCount = 0;
		let faceCount = 0;

		if ((child as THREE.Mesh).isMesh) {
			type = "mesh";
			const mesh = child as THREE.Mesh;
			const geo = mesh.geometry;
			vertexCount = geo.attributes.position?.count ?? 0;
			if (geo.index) {
				faceCount = geo.index.count / 3;
			} else {
				faceCount = vertexCount / 3;
			}
		} else if (child.children.length === 0) {
			type = "empty";
		}

		results.push({
			uuid: child.uuid,
			name: child.name || child.type,
			type,
			vertexCount,
			faceCount,
			visible: child.visible,
			markedAs: child.userData.markedAs ?? null,
		});
	});
	return results;
}

/** Find an object by UUID in the model tree. */
export function selectObject(model: THREE.Group, uuid: string): THREE.Object3D | null {
	let found: THREE.Object3D | null = null;
	model.traverse((child) => {
		if (child.uuid === uuid) found = child;
	});
	return found;
}

/** Remove an object from its parent and dispose geometry/material. */
export function deleteObject(model: THREE.Group, uuid: string): void {
	model.traverse((child) => {
		if (child.uuid === uuid && child.parent) {
			child.parent.remove(child);
			disposeObject(child);
		}
	});
}

function disposeObject(obj: THREE.Object3D): void {
	if ((obj as THREE.Mesh).isMesh) {
		const mesh = obj as THREE.Mesh;
		mesh.geometry.dispose();
		const mat = mesh.material;
		if (Array.isArray(mat)) {
			for (const m of mat) disposeMaterial(m);
		} else {
			disposeMaterial(mat);
		}
	}
	for (const child of obj.children) {
		disposeObject(child);
	}
}

function disposeMaterial(mat: THREE.Material): void {
	mat.dispose();
	if ("map" in mat && (mat as any).map) (mat as any).map.dispose();
}

/** Toggle visibility of an object by UUID. */
export function toggleObjectVisibility(model: THREE.Group, uuid: string): void {
	const obj = selectObject(model, uuid);
	if (obj) obj.visible = !obj.visible;
}

/** Mark an object with a classification tag (stored in userData.markedAs). */
export function markObjectAs(model: THREE.Group, uuid: string, type: string | null): void {
	const obj = selectObject(model, uuid);
	if (!obj) return;
	if (type) {
		obj.userData.markedAs = type;
	} else {
		delete obj.userData.markedAs;
	}
}

/** Highlight color per component type + position.
 *  Each type has a base hue. Each position has a brightness level:
 *    FL = brightest, FR = bright, RL = medium, RR = dim
 *  For centered objects (no side), just F/R.
 *  So you can distinguish type (color family) AND position (brightness) at a glance. */
const HIGHLIGHT_COLORS: Record<string, number> = {
	// Wheels — 4 distinct hues (green, lime, teal, yellow-green)
	wheel_FL: 0x00ff88, // mint green
	wheel_FR: 0x88ff00, // chartreuse
	wheel_RL: 0x00ddcc, // teal
	wheel_RR: 0xccdd00, // yellow-green
	// Brake discs — 4 distinct hues (warm family)
	brake_disc_FL: 0xff6644, // red-orange
	brake_disc_FR: 0xffaa22, // amber
	brake_disc_RL: 0xff4488, // pink
	brake_disc_RR: 0xffcc44, // gold
	// Headlights — cool blue-white family
	headlight_F: 0xaaccff,
	headlight_FL: 0x88bbff,
	headlight_FR: 0xaaeeff,
	headlight_R: 0xccbbff, // slight purple tint for rear
	headlight_RL: 0xbbaaff,
	headlight_RR: 0xddccff,
	headlight: 0xaaccff, // fallback
	// Taillights — red family with brightness variation
	taillight_F: 0xff3344,
	taillight_FL: 0xff5566,
	taillight_FR: 0xff4455,
	taillight_R: 0xff2233,
	taillight_RL: 0xff6677,
	taillight_RR: 0xff1133,
	taillight: 0xff3344, // fallback
	// Exhausts — purple/magenta family
	exhaust_F: 0xbb66ff,
	exhaust_FL: 0xdd88ff,
	exhaust_FR: 0xaa55ee,
	exhaust_R: 0xff66bb,
	exhaust_RL: 0xcc77ff,
	exhaust_RR: 0xee77cc,
};

const DEFAULT_HIGHLIGHT = 0x4a9eff; // blue

/** Clone material(s) so modifications are per-mesh, not per-shared-material. */
function cloneMaterials(mat: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
	if (Array.isArray(mat)) return mat.map((m) => m.clone());
	return mat.clone();
}

/** Highlight an object using emissive color.
 *  Clones the material first so shared materials don't affect other meshes.
 *  If no color given, picks the highlight color based on the object's markedAs type. */
export function highlightObject(model: THREE.Group, uuid: string, color?: number): void {
	const obj = selectObject(model, uuid);
	if (!obj || !(obj as THREE.Mesh).isMesh) return;
	const mesh = obj as THREE.Mesh;
	const c = color ?? HIGHLIGHT_COLORS[obj.userData.markedAs ?? ""] ?? DEFAULT_HIGHLIGHT;
	// Clone material so this highlight is per-mesh, not per-material
	mesh.material = cloneMaterials(mesh.material);
	const mat = mesh.material;
	if (Array.isArray(mat)) {
		for (const m of mat) {
			if ("emissive" in m) {
				const sm = m as THREE.MeshStandardMaterial;
				sm.userData._prevEmissive = sm.emissive.getHex();
				sm.emissive.setHex(c);
				sm.emissiveIntensity = 0.4;
			}
		}
	} else if ("emissive" in mat) {
		const sm = mat as THREE.MeshStandardMaterial;
		sm.userData._prevEmissive = sm.emissive.getHex();
		sm.emissive.setHex(c);
		sm.emissiveIntensity = 0.4;
	}
}

/** Remove highlight from an object.
 *  Restores emissive to pre-highlight value (stored in userData). */
export function unhighlightObject(model: THREE.Group, uuid: string): void {
	const obj = selectObject(model, uuid);
	if (!(obj as THREE.Mesh).isMesh) return;
	const mesh = obj as THREE.Mesh;
	const mat = mesh.material;
	if (Array.isArray(mat)) {
		for (const m of mat) {
			if ("emissive" in m && "userData" in m) {
				const sm = m as THREE.MeshStandardMaterial;
				const prev = sm.userData._prevEmissive;
				sm.emissive.setHex(prev ?? 0x000000);
				sm.emissiveIntensity = prev ? 0.4 : 0;
			}
		}
	} else if ("emissive" in mat && "userData" in mat) {
		const sm = mat as THREE.MeshStandardMaterial;
		const prev = sm.userData._prevEmissive;
		sm.emissive.setHex(prev ?? 0x000000);
		sm.emissiveIntensity = prev ? 0.4 : 0;
	}
}

// Re-export material utilities for backward compatibility
export {
	autoSetupLightMaterial,
	duplicateMaterialForObject,
} from "./material-utils.js";
