/**
 * Auto-detect wheels and lights from a loaded GLB model.
 */
import * as THREE from "three";

export interface DetectedMarker {
	type: string;
	name: string;
	position: THREE.Vector3;
	confidence: number; // 0-1
}

export interface AutoDetectResult {
	wheels: DetectedMarker[];
	lights: DetectedMarker[];
	exhausts: DetectedMarker[];
}

/**
 * Scan a model group for cylindrical meshes (wheel candidates).
 */
function detectWheels(model: THREE.Group): DetectedMarker[] {
	const candidates: { mesh: THREE.Mesh; score: number; name: string }[] = [];

	model.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		const geo = mesh.geometry;

		// Check bounding box proportions: wheels are roughly cylindrical
		// (one axis much shorter than the other two, or all similar for thin disc)
		geo.computeBoundingBox();
		const size = new THREE.Vector3();
		geo.boundingBox!.getSize(size);
		const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
		const ratio1 = sorted[0] / Math.max(sorted[1], 0.001); // thin vs medium
		const ratio2 = sorted[1] / Math.max(sorted[2], 0.001); // medium vs long

		let score = 0;

		// Name patterns
		const name = mesh.name.toLowerCase();
		if (/wheel|tire|rim|wheelrig/.test(name)) score += 0.5;
		if (/front|fl|fr|_f/.test(name)) score += 0.2;
		if (/rear|rl|rr|_r/.test(name)) score += 0.2;

		// Shape: disc-like (one dimension much smaller)
		if (ratio1 < 0.3) score += 0.3;
		// Or nearly cylindrical (all dims similar = sphere-ish wheel)
		else if (ratio2 > 0.6 && ratio2 < 1.4) score += 0.2;

		// Must be somewhat round in at least one plane
		const midToLong = sorted[1] / Math.max(sorted[2], 0.001);
		if (midToLong > 0.7) score += 0.1;

		if (score > 0.3) {
			candidates.push({ mesh, score, name: mesh.name });
		}
	});

	// Sort by score, take top candidates
	candidates.sort((a, b) => b.score - a.score);

	// Classify into FL/FR/RL/RR by position
	const wheels: DetectedMarker[] = [];
	const used = new Set<THREE.Mesh>();

	for (const c of candidates.slice(0, 8)) {
		if (used.has(c.mesh)) continue;
		used.add(c.mesh);

		const worldPos = new THREE.Vector3();
		c.mesh.getWorldPosition(worldPos);

		// Determine side (L/R) and axle (F/R) relative to model center
		const modelBox = new THREE.Box3().setFromObject(model);
		const modelCenter = modelBox.getCenter(new THREE.Vector3());

		const isLeft = worldPos.x < modelCenter.x;
		const isFront = worldPos.z > modelCenter.z; // car faces +Z

		let typeName: string;
		if (isFront && isLeft) typeName = "Wheel_FL";
		else if (isFront && !isLeft) typeName = "Wheel_FR";
		else if (!isFront && isLeft) typeName = "Wheel_RL";
		else typeName = "Wheel_RR";

		wheels.push({
			type: typeName,
			name: c.name,
			position: worldPos.clone(),
			confidence: Math.min(c.score, 1),
		});
	}

	return wheels;
}

/**
 * Scan for emissive materials or light-named meshes.
 */
function detectLights(model: THREE.Group): DetectedMarker[] {
	const lights: DetectedMarker[] = [];

	model.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		const mat = mesh.material;
		if (!mat || !(mat instanceof THREE.Material)) return;

		const name = mesh.name.toLowerCase();
		const worldPos = new THREE.Vector3();
		mesh.getWorldPosition(worldPos);

		// Check emissive
		if ("emissive" in mat) {
			const emissiveMat = mat as THREE.MeshStandardMaterial;
			if (emissiveMat.emissive && emissiveMat.emissiveIntensity > 0.1) {
				const eColor = emissiveMat.emissive;
				const brightness = eColor.r + eColor.g + eColor.b;
				if (brightness > 0.3) {
					const isFront = /front|head|lamp/.test(name) || worldPos.z > 0;
					lights.push({
						type: isFront ? "Headlight_L" : "Taillight_L",
						name: mesh.name,
						position: worldPos.clone(),
						confidence: 0.8,
					});
					return;
				}
			}
		}

		// Name patterns
		if (/headlight|head_light|front_light|lamp/.test(name)) {
			lights.push({ type: "Headlight_L", name: mesh.name, position: worldPos.clone(), confidence: 0.7 });
		} else if (/taillight|tail_light|back_light|brake_light/.test(name)) {
			lights.push({ type: "Taillight_L", name: mesh.name, position: worldPos.clone(), confidence: 0.7 });
		}
	});

	// Pair left/right if multiple of same type
	const grouped = new Map<string, DetectedMarker[]>();
	for (const l of lights) {
		const base = l.type.replace(/_[LR]$/, "");
		if (!grouped.has(base)) grouped.set(base, []);
		grouped.get(base)!.push(l);
	}

	const paired: DetectedMarker[] = [];
	for (const [base, items] of grouped) {
		if (items.length === 2) {
			items.sort((a, b) => a.position.x - b.position.x);
			items[0].type = base + "_L";
			items[1].type = base + "_R";
			paired.push(...items);
		} else {
			paired.push(...items);
		}
	}

	return paired;
}

/**
 * Scan for exhaust pipes by name.
 */
function detectExhausts(model: THREE.Group): DetectedMarker[] {
	const exhausts: DetectedMarker[] = [];

	model.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const name = child.name.toLowerCase();
		if (/exhaust|escape|pipe|muffler/.test(name)) {
			const pos = new THREE.Vector3();
			child.getWorldPosition(pos);
			exhausts.push({
				type: "Exhaust_L",
				name: child.name,
				position: pos.clone(),
				confidence: 0.6,
			});
		}
	});

	return exhausts;
}

export function autoDetect(model: THREE.Group): AutoDetectResult {
	return {
		wheels: detectWheels(model),
		lights: detectLights(model),
		exhausts: detectExhausts(model),
	};
}
