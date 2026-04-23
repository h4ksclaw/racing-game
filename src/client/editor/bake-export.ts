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

/** Map editor markedAs values to baked wheel marker names for reparenting. */
const BRAKE_TO_WHEEL: Record<string, string> = {
	brake_disc_FL: "WheelRig_FrontLeft",
	brake_disc_FR: "WheelRig_FrontRight",
	brake_disc_RL: "WheelRig_RearLeft",
	brake_disc_RR: "WheelRig_RearRight",
};

export async function bakeModel(
	model: THREE.Group,
	markers: MarkerData[],
	options?: {
		includeMarkers?: boolean;
		applyObjectMarks?: boolean;
		/** Bake model.scale into geometry so output has scale=1. Default true. */
		bakeScale?: boolean;
	},
): Promise<BakeResult> {
	const { includeMarkers = true, applyObjectMarks = true, bakeScale = true } = options ?? {};

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

	// Bake model scale into geometry so the output GLB has scale=1
	if (bakeScale) {
		clone.updateMatrixWorld(true);
		clone.traverse((child) => {
			if ((child as THREE.Mesh).isMesh) {
				const mesh = child as THREE.Mesh;
				mesh.geometry.applyMatrix4(child.matrixWorld);
				child.position.set(0, 0, 0);
				child.rotation.set(0, 0, 0);
				child.scale.set(1, 1, 1);
				// Also clear parent transforms
				if (child.parent && child.parent !== clone) {
					child.position.copy(child.position); // already 0,0,0
				}
			}
		});
		// Reset root transform
		clone.position.set(0, 0, 0);
		clone.rotation.set(0, 0, 0);
		clone.scale.set(1, 1, 1);
		clone.updateMatrixWorld(true);
	}

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
		// Auto-generate PhysicsMarker from wheel positions (ground plane reference)
		const wheelTypes = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"];
		const wheelMarkers = wheelTypes.map((t) => markers.find((m) => m.type === t)).filter((m): m is MarkerData => !!m);

		if (wheelMarkers.length === 4) {
			// PhysicsMarker goes at center of wheelbase, at wheel bottom (ground plane)
			const centerX = (wheelMarkers[0].position.x + wheelMarkers[1].position.x) / 2;
			const centerZ = (wheelMarkers[2].position.z + wheelMarkers[3].position.z) / 2;
			const groundY = Math.min(...wheelMarkers.map((w) => w.position.y));
			const empty = new THREE.Object3D();
			empty.name = "PhysicsMarker";
			empty.position.set(centerX, groundY, centerZ);
			clone.add(empty);
		}

		// Bake user-placed markers (wheels, lights, exhaust)
		for (const marker of markers) {
			const markerName = MARKER_NAME_MAP[marker.type] ?? marker.type;
			const empty = new THREE.Object3D();
			empty.name = markerName;
			empty.position.copy(marker.position);
			clone.add(empty);
		}
	}

	// Reparent brake disc meshes under their wheel pivots so suspension works at runtime.
	// Find meshes marked brake_disc_XX and move them under the corresponding WheelRig marker.
	const wheelPivots = new Map<string, THREE.Object3D>();
	clone.traverse((child) => {
		if (child.name && Object.values(BRAKE_TO_WHEEL).includes(child.name)) {
			wheelPivots.set(child.name, child);
		}
	});
	const toReparent: THREE.Object3D[] = [];
	clone.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const markedAs = child.userData.markedAs as string | undefined;
		if (!markedAs || !BRAKE_TO_WHEEL[markedAs]) return;
		const wheelMarkerName = BRAKE_TO_WHEEL[markedAs];
		const pivot = wheelPivots.get(wheelMarkerName);
		if (pivot && child.parent !== pivot) {
			toReparent.push(child);
		}
	});
	for (const mesh of toReparent) {
		const markedAs = mesh.userData.markedAs as string;
		const wheelMarkerName = BRAKE_TO_WHEEL[markedAs];
		const pivot = wheelPivots.get(wheelMarkerName)!;
		// Bake world transform into geometry before reparenting
		mesh.updateWorldMatrix(true, false);
		const wm = mesh.matrixWorld.clone();
		(mesh as THREE.Mesh).geometry.applyMatrix4(wm);
		mesh.position.set(0, 0, 0);
		mesh.rotation.set(0, 0, 0);
		mesh.scale.set(1, 1, 1);
		// Convert world position to pivot-local
		const worldPos = new THREE.Vector3();
		mesh.getWorldPosition(worldPos);
		pivot.updateMatrixWorld(true);
		const localPos = pivot.worldToLocal(worldPos.clone());
		mesh.position.copy(localPos);
		pivot.add(mesh);
		console.log(`[bake] Reparented brake disc "${mesh.name}" under ${wheelMarkerName}`);
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
