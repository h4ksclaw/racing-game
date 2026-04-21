/**
 * Export car config from placed markers.
 */
import type { CarModelSchema, ChassisSpec } from "@client/vehicle/configs.js";
import { API_BASE } from "./editor-main.js";
import type { MarkerData } from "./marker-tool.js";

function findMarker(markers: MarkerData[], type: string): MarkerData | undefined {
	return markers.find((m) => m.type === type);
}

function computeHalfExtents(markers: MarkerData[]): [number, number, number] {
	const fl = findMarker(markers, "Wheel_FL");
	const fr = findMarker(markers, "Wheel_FR");
	const rl = findMarker(markers, "Wheel_RL");
	const rr = findMarker(markers, "Wheel_RR");
	const pm = findMarker(markers, "PhysicsMarker");

	if (!fl || !fr || !rl || !rr) return [1, 0.5, 2];

	const wheels = [fl, fr, rl, rr];
	const xs = wheels.map((w) => Math.abs(w.position.x));
	const zs = wheels.map((w) => w.position.z);
	const ys = wheels.map((w) => w.position.y);

	const halfWidth = Math.max(...xs) + 0.1;
	const halfLength = (Math.max(...zs) - Math.min(...zs)) / 2 + 0.3;
	const halfHeight = (pm ? pm.position.y : Math.max(...ys)) + 0.15;

	return [halfWidth, halfHeight, halfLength];
}

function computeWheelRadius(markers: MarkerData[]): number {
	const wheels = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]
		.map((t) => findMarker(markers, t))
		.filter(Boolean) as MarkerData[];

	if (wheels.length === 0) return 0.3;
	const radii = wheels.map((w) => w.position.y);
	return radii.reduce((a, b) => a + b, 0) / radii.length;
}

function computeWheelPositions(markers: MarkerData[]): { x: number; y: number; z: number }[] {
	const order = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;
	return order.map((type) => {
		const m = findMarker(markers, type);
		if (!m) return { x: 0, y: 0, z: 0 };
		return { x: m.position.x, y: m.position.y, z: m.position.z };
	});
}

function computeWheelBase(markers: MarkerData[]): number {
	const fl = findMarker(markers, "Wheel_FL");
	const rl = findMarker(markers, "Wheel_RL");
	if (!fl || !rl) return 2.5;
	return Math.abs(fl.position.z - rl.position.z);
}

function computeCgHeight(markers: MarkerData[]): number {
	const pm = findMarker(markers, "PhysicsMarker");
	return pm ? pm.position.y : 0.35;
}

export interface ValidationIssue {
	type: "error" | "warn";
	message: string;
}

export function validateMarkers(markers: MarkerData[]): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (!findMarker(markers, "PhysicsMarker")) {
		issues.push({ type: "error", message: "Missing PhysicsMarker" });
	}

	const wheelTypes = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"];
	const missingWheels = wheelTypes.filter((t) => !findMarker(markers, t));
	if (missingWheels.length > 0) {
		issues.push({ type: "error", message: `Missing wheels: ${missingWheels.join(", ")}` });
	}

	const fl = findMarker(markers, "Wheel_FL");
	const fr = findMarker(markers, "Wheel_FR");
	if (fl && fr && Math.abs(Math.abs(fl.position.x) - Math.abs(fr.position.x)) > 0.05) {
		issues.push({ type: "warn", message: "Front wheels not symmetric" });
	}

	const rl = findMarker(markers, "Wheel_RL");
	const rr = findMarker(markers, "Wheel_RR");
	if (rl && rr && Math.abs(Math.abs(rl.position.x) - Math.abs(rr.position.x)) > 0.05) {
		issues.push({ type: "warn", message: "Rear wheels not symmetric" });
	}

	const radius = computeWheelRadius(markers);
	if (radius < 0.15 || radius > 0.6) {
		issues.push({ type: "warn", message: `Suspicious wheel radius: ${radius.toFixed(2)}m` });
	}

	const noLights = !findMarker(markers, "Headlight_L") && !findMarker(markers, "Taillight_L");
	if (noLights) {
		issues.push({ type: "warn", message: "No light markers placed" });
	}

	return issues;
}

export function generateChassisConfig(markers: MarkerData[]): ChassisSpec {
	return {
		mass: 1200,
		halfExtents: computeHalfExtents(markers),
		wheelRadius: computeWheelRadius(markers),
		wheelPositions: computeWheelPositions(markers),
		wheelBase: computeWheelBase(markers),
		maxSteerAngle: 0.6,
		suspensionStiffness: 50,
		suspensionRestLength: 0.3,
		dampingRelaxation: 2.3,
		dampingCompression: 4.4,
		rollInfluence: 0.1,
		maxSuspensionTravel: 0.3,
		cgHeight: computeCgHeight(markers),
		weightFront: 0.55,
	};
}

export function generateModelSchema(markers: MarkerData[]): CarModelSchema {
	const wheels: [string, string, string, string] = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"];
	const escapePipes: { left?: string; right?: string } = {};
	const exL = findMarker(markers, "Exhaust_L");
	const exR = findMarker(markers, "Exhaust_R");
	if (exL) escapePipes.left = "Exhaust_L";
	if (exR) escapePipes.right = "Exhaust_R";

	return {
		wheelModelPath: "/assets/new-car/car.glb",
		markers: {
			physicsMarker: "PhysicsMarker",
			wheels,
			...(Object.keys(escapePipes).length > 0 ? { escapePipes } : {}),
		},
		materials: {
			headlight: "front_light_1",
			taillight: "back_light",
		},
		wheelTemplateNode: "wheel_1",
		brakeDiscMaterials: ["Break"],
	};
}

export interface ExportPayload {
	carName: string;
	modelPath: string;
	modelScale: number;
	chassis: ChassisSpec;
	schema: CarModelSchema;
	markers: { type: string; position: { x: number; y: number; z: number } }[];
}

export function generateExport(
	carName: string,
	modelPath: string,
	modelScale: number,
	markers: MarkerData[],
): ExportPayload {
	return {
		carName,
		modelPath,
		modelScale,
		chassis: generateChassisConfig(markers),
		schema: generateModelSchema(markers),
		markers: markers.map((m) => ({
			type: m.type,
			position: { x: m.position.x, y: m.position.y, z: m.position.z },
		})),
	};
}

export async function saveConfig(payload: ExportPayload): Promise<{ ok: boolean; error?: string }> {
	try {
		const resp = await fetch(`${API_BASE}/cars/config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
		return { ok: true };
	} catch (e: any) {
		return { ok: false, error: e.message };
	}
}

export function downloadJSON(payload: ExportPayload, filename?: string) {
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename ?? `${payload.carName.replace(/\s+/g, "-").toLowerCase()}-config.json`;
	a.click();
	URL.revokeObjectURL(url);
}
