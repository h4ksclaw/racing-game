/**
 * Browser-side GLB baking — clones the model, embeds markers, exports via GLTFExporter.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { MarkerData } from "./marker-tool.js";

export interface PhysicsOverrides {
	mass: number;
	suspensionStiffness: number;
	suspensionRestLength: number;
	maxSuspensionTravel: number;
	dampingRelaxation: number;
	dampingCompression: number;
	rollInfluence: number;
	maxSteerAngle: number;
	cgHeight: number;
	weightFront: number;
	corneringStiffnessFront: number;
	corneringStiffnessRear: number;
	peakFriction: number;
}

export interface BakeResult {
	glbBlob: Blob;
	glbBuffer: ArrayBuffer;
	size: number;
}

const MARKER_NAME_MAP: Record<string, string> = {
	Wheel_FL: "WheelRig_FrontLeft",
	Wheel_FR: "WheelRig_FrontRight",
	Wheel_RL: "WheelRig_RearLeft",
	Wheel_RR: "WheelRig_RearRight",
	PhysicsMarker: "PhysicsMarker",
	Headlight_L: "Headlight_L",
	Headlight_R: "Headlight_R",
	Taillight_L: "Taillight_L",
	Taillight_R: "Taillight_R",
	Exhaust_L: "Exhaust_L",
	Exhaust_R: "Exhaust_R",
};

export async function bakeModel(
	model: THREE.Group,
	markers: MarkerData[],
	options?: {
		includeMarkers?: boolean;
		applyObjectMarks?: boolean;
	},
): Promise<BakeResult> {
	const { includeMarkers = true, applyObjectMarks = true } = options ?? {};

	const clone = model.clone(true);
	clone.traverse((child) => {
		if ((child as THREE.Mesh).isMesh) {
			const mesh = child as THREE.Mesh;
			mesh.geometry = mesh.geometry.clone();
			if (Array.isArray(mesh.material)) {
				mesh.material = mesh.material.map((m) => m.clone());
			} else {
				mesh.material = mesh.material.clone();
			}
		}
	});

	if (applyObjectMarks) {
		clone.traverse((child) => {
			if (!(child as THREE.Mesh).isMesh) return;
			const mesh = child as THREE.Mesh;
			const name = child.name.toLowerCase();
			if (name.includes("light") || name.includes("headlight") || name.includes("taillight")) {
				if (Array.isArray(mesh.material)) {
					mesh.material = mesh.material.map((m) => {
						const c = m.clone();
						if ("emissive" in c) {
							(c as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffffff);
							(c as THREE.MeshStandardMaterial).emissiveIntensity = 2.0;
						}
						return c;
					});
				} else if ("emissive" in mesh.material) {
					(mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffffff);
					(mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0;
				}
			}
		});
	}

	if (includeMarkers) {
		for (const marker of markers) {
			const markerName = MARKER_NAME_MAP[marker.type] ?? marker.type;
			const empty = new THREE.Object3D();
			empty.name = markerName;
			empty.position.copy(marker.position);
			clone.add(empty);
		}
	}

	const exporter = new GLTFExporter();
	// parseAsync may not be in the type defs — use the callback-based API
	const glb: ArrayBuffer = await new Promise((resolve, reject) => {
		exporter.parse(
			clone,
			(result) => {
				if (result instanceof ArrayBuffer) resolve(result);
				else reject(new Error("Expected ArrayBuffer from GLTFExporter"));
			},
			(err) => reject(err),
			{ binary: true },
		);
	});

	return {
		glbBlob: new Blob([glb], { type: "model/gltf-binary" }),
		glbBuffer: glb,
		size: glb.byteLength,
	};
}
