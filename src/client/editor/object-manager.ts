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
	markedAs: string | null; // 'wheel', 'headlight', 'taillight', 'brake_disc', null
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

/** Highlight an object using emissive color. */
export function highlightObject(model: THREE.Group, uuid: string, color: number = 0x4a9eff): void {
	const obj = selectObject(model, uuid);
	if (!(obj as THREE.Mesh).isMesh) return;
	const mesh = obj as THREE.Mesh;
	const mat = mesh.material;
	if (Array.isArray(mat)) {
		for (const m of mat) {
			if ("emissive" in m) {
				(m as THREE.MeshStandardMaterial).userData._prevEmissive = (m as THREE.MeshStandardMaterial).emissive.getHex();
				(m as THREE.MeshStandardMaterial).emissive.setHex(color);
				(m as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
			}
		}
	} else if ("emissive" in mat) {
		(mat as THREE.MeshStandardMaterial).userData._prevEmissive = (mat as THREE.MeshStandardMaterial).emissive.getHex();
		(mat as THREE.MeshStandardMaterial).emissive.setHex(color);
		(mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
	}
}

/** Remove highlight from an object. */
export function unhighlightObject(model: THREE.Group, uuid: string): void {
	const obj = selectObject(model, uuid);
	if (!(obj as THREE.Mesh).isMesh) return;
	const mesh = obj as THREE.Mesh;
	const mat = mesh.material;
	if (Array.isArray(mat)) {
		for (const m of mat) {
			if ("emissive" in m && "userData" in m) {
				const prev = (m as THREE.MeshStandardMaterial).userData._prevEmissive;
				(m as THREE.MeshStandardMaterial).emissive.setHex(prev ?? 0x000000);
				(m as THREE.MeshStandardMaterial).emissiveIntensity = prev ? 0.4 : 0;
			}
		}
	} else if ("emissive" in mat && "userData" in mat) {
		const prev = (mat as THREE.MeshStandardMaterial).userData._prevEmissive;
		(mat as THREE.MeshStandardMaterial).emissive.setHex(prev ?? 0x000000);
		(mat as THREE.MeshStandardMaterial).emissiveIntensity = prev ? 0.4 : 0;
	}
}

/**
 * Duplicate material for an object (for bloom effect on lights).
 * Clones the material, preserves all properties, assigns new name with prefix.
 */
export function duplicateMaterialForObject(obj: THREE.Object3D, newName: string): THREE.Material | null {
	if (!(obj as THREE.Mesh).isMesh) return null;
	const mesh = obj as THREE.Mesh;
	const mat = mesh.material;
	if (Array.isArray(mat)) {
		// Clone first material in array
		const clone = mat[0].clone();
		clone.name = newName;
		mesh.material = [clone, ...mat.slice(1)];
		obj.userData.bloomMaterial = clone;
		return clone;
	} else {
		const clone = mat.clone();
		clone.name = newName;
		mesh.material = clone;
		obj.userData.bloomMaterial = clone;
		return clone;
	}
}
