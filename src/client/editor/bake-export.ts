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

/** Map editor wheel markedAs values to WheelRig pivot names. */
const WHEEL_TO_PIVOT: Record<string, string> = {
	wheel_FL: "WheelRig_FrontLeft",
	wheel_FR: "WheelRig_FrontRight",
	wheel_RL: "WheelRig_RearLeft",
	wheel_RR: "WheelRig_RearRight",
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

	// ── Persist virtual groups via extras (GLTFExporter reads object.extras) ──
	clone.traverse((child) => {
		const mesh = child as THREE.Mesh;
		if (!mesh.isMesh) return;
		const vg = mesh.userData.virtualGroups as Record<string, { name: string; markedAs: string | null; faces: number[] }> | undefined;
		if (vg && Object.keys(vg).length > 0) {
			// Merge with existing extras if any
			const existing = (child as any).extras ?? {};
			existing.virtualGroups = vg;
			(child as any).extras = existing;
		}
		// Also preserve whole-mesh bloom tag if set
		if (mesh.userData.bloom) {
			const existing = (child as any).extras ?? {};
			existing.bloom = true;
			(child as any).extras = existing;
		}
	});

	if (applyObjectMarks) {
		// ── Pass 1: Strip editor highlights + set up light materials ──
		// The editor's highlightObject() clones materials and sets emissiveIntensity=0.4.
		// We restore pre-highlight values, then configure light materials for runtime.
		clone.traverse((child) => {
			if (!(child as THREE.Mesh).isMesh) return;
			const mesh = child as THREE.Mesh;
			const marked = mesh.userData.markedAs as string | undefined;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

			// Debug: log any mesh with markedAs
			if (marked) {
				console.log(`[bake] Pass1 mesh "${mesh.name}" markedAs=${marked} emissive=(${mats.map(m => m instanceof THREE.MeshStandardMaterial ? `${m.emissive.getHex().toString(16)}@${m.emissiveIntensity}` : 'non-std').join(', ')})`);
			}

			for (const m of mats) {
				if (!(m instanceof THREE.MeshStandardMaterial)) continue;

				// Strip editor highlight by restoring pre-highlight emissive.
				// highlightObject() stores _prevEmissive (hex color) on material userData.
				// It does NOT store the original intensity — so we force-intensity to 0
				// and let the light setup below override if needed.
				const prevEmissive = m.userData._prevEmissive as number | undefined;
				if (prevEmissive !== undefined) {
					m.emissive.setHex(prevEmissive);
					m.emissiveIntensity = 0; // clear highlight; light setup overrides below
					delete m.userData._prevEmissive;
				}

				// Set up light materials for runtime control (NOT permanently on)
				// IMPORTANT: Three.js GLTFLoader does NOT support KHR_materials_emissive_strength.
				// It ignores emissiveStrength and defaults emissiveIntensity to 1.0.
				// So we must bake the effective emissive into emissiveFactor (the color) itself.
				// For "off" lights: set emissiveFactor = [0,0,0] (black = no glow regardless of intensity).
				// For "dim" lights (taillights): set emissiveFactor to a very dim color.
				// VehicleLights.applyHeadlightEmissive/TaillightEmissive will override at runtime.
				const isHeadlight = marked?.includes("headlight");
				const isTaillight = marked?.includes("taillight");
				if (isHeadlight) {
					m.emissive.setHex(0x000000); // OFF — black emissive, no glow
					m.emissiveIntensity = 1.0; // must be 1.0 to match GLTFLoader default
					m.name = m.name || "front_light_1";
				} else if (isTaillight) {
					m.emissive.setHex(0x1a0000); // very dim red base (0.1 * red)
					m.emissiveIntensity = 1.0;
					m.color.setHex(0x330000);
					m.name = m.name || "back_light";
				}
			}

			// NOTE: We do NOT hide wheel-marked meshes here.
			// Wheel meshes are part of the car model and should remain visible.
			// External wheel GLBs are loaded separately at runtime and positioned
			// at WheelRig markers — they overlay (not replace) baked wheel geometry.
			// If the user wants to hide specific meshes, they can do so in the editor.
		});

		// ── Pass 2: Force-black ALL headlight emissive color ──
		// Safety net: ensure no headlight-marked mesh has non-black emissive in the GLB.
		// Three.js GLTFLoader ignores KHR_materials_emissive_strength, so we must
		// bake the "off" state into emissiveFactor (the color) itself.
		clone.traverse((child) => {
			if (!(child as THREE.Mesh).isMesh) return;
			const mesh = child as THREE.Mesh;
			const marked = mesh.userData.markedAs as string | undefined;
			if (!marked?.includes("headlight")) return;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const m of mats) {
				if (!(m instanceof THREE.MeshStandardMaterial)) continue;
				const maxC = Math.max(m.emissive.r, m.emissive.g, m.emissive.b);
				if (maxC > 0.01) {
					console.warn(`[bake] Force-blacking headlight emissive on "${mesh.name}" (was [${m.emissive.r},${m.emissive.g},${m.emissive.b}])`);
					m.emissive.setHex(0x000000);
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

	// Reparent wheel meshes + brake disc meshes under their wheel pivots.
	// This ensures wheels spin with the WheelRig at runtime.
	const wheelPivots = new Map<string, THREE.Object3D>();
	clone.traverse((child) => {
		if (child.name && Object.values(WHEEL_TO_PIVOT).includes(child.name)) {
			wheelPivots.set(child.name, child);
		}
	});

	// Collect meshes to reparent: both wheels and brake discs
	const toReparent: { mesh: THREE.Object3D; pivotName: string; kind: string }[] = [];
	clone.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const markedAs = child.userData.markedAs as string | undefined;
		if (!markedAs) return;
		const pivotName = WHEEL_TO_PIVOT[markedAs] || BRAKE_TO_WHEEL[markedAs];
		if (!pivotName) return;
		const pivot = wheelPivots.get(pivotName);
		if (pivot && child.parent !== pivot) {
			toReparent.push({ mesh: child, pivotName, kind: WHEEL_TO_PIVOT[markedAs] ? 'wheel' : 'brake disc' });
		}
	});

	for (const { mesh, pivotName, kind } of toReparent) {
		const pivot = wheelPivots.get(pivotName)!;
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
		console.log(`[bake] Reparented ${kind} "${mesh.name}" under ${pivotName}`);
	}

	// ── Debug: Verify headlight emissive right before export ──
	clone.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		const marked = mesh.userData.markedAs as string | undefined;
		if (!marked?.includes("headlight")) return;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const m of mats) {
			if (m instanceof THREE.MeshStandardMaterial) {
				console.log(`[bake] PRE-EXPORT "${mesh.name}" material="${m.name}" emissive=[${m.emissive.r},${m.emissive.g},${m.emissive.b}] intensity=${m.emissiveIntensity}`);
			}
		}
	});

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
