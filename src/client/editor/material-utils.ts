/**
 * Material utilities — consolidated material operations for the editor.
 * Handles light material setup, material duplication, and brake disc material renaming.
 */
import type * as THREE from "three";

/**
 * Clone material for an object and set emissive for light markers (headlight/taillight).
 * Used when marking objects as headlights or taillights in the object panel.
 */
export function autoSetupLightMaterial(
	obj: THREE.Object3D,
	lightType: "headlight" | "taillight",
): THREE.Material | null {
	if (!(obj as THREE.Mesh).isMesh) return null;
	const mesh = obj as THREE.Mesh;
	const mat = mesh.material;
	const clone = (Array.isArray(mat) ? mat[0] : mat).clone();
	const side = lightType === "headlight" ? "Headlight" : "Taillight";
	clone.name = `mat_${side}_${obj.name || "mesh"}`;
	if ("emissive" in clone) {
		const stdMat = clone as THREE.MeshStandardMaterial;
		stdMat.emissive.set(lightType === "headlight" ? 0xffffff : 0xff2222);
		stdMat.emissiveIntensity = 1.0;
	}
	if (Array.isArray(mat)) {
		mesh.material = [clone, ...mat.slice(1)];
	} else {
		mesh.material = clone;
	}
	obj.userData.bloomMaterial = clone;
	return clone;
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

/**
 * Clone material and rename to "Break" so the runtime's extractBrakeDiscs() picks it up.
 * Called when marking an object as brake_disc_FL/FR/RL/RR in the object panel.
 */
export function renameMaterialForBrakeDisc(obj: THREE.Object3D): void {
	if (!(obj as THREE.Mesh).isMesh) return;
	const mesh = obj as THREE.Mesh;
	const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
	if (!mat) return;
	// Clone to avoid affecting other meshes that share the same material
	const clone = mat.clone();
	clone.name = "Break";
	mesh.material = clone;
}
