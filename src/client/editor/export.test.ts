/**
 * Tests for car editor export module — validation, config generation.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { generateChassisConfig, generateExport, generateModelSchema, validateMarkers } from "./export.ts";
import type { MarkerData } from "./marker-tool.js";

// ── Helpers ──

function makeMarker(type: string, x: number, y: number, z: number): MarkerData {
	return {
		id: `m_${type}`,
		type,
		position: new THREE.Vector3(x, y, z),
		mesh: new THREE.Mesh(),
	};
}

const FULL_MARKERS: MarkerData[] = [
	makeMarker("PhysicsMarker", 0, 0.35, 0.5),
	makeMarker("Wheel_FL", -0.8, 0.31, 1.3),
	makeMarker("Wheel_FR", 0.8, 0.31, 1.3),
	makeMarker("Wheel_RL", -0.8, 0.31, -1.2),
	makeMarker("Wheel_RR", 0.8, 0.31, -1.2),
	makeMarker("Headlight_L", -0.6, 0.5, 2.1),
	makeMarker("Headlight_R", 0.6, 0.5, 2.1),
	makeMarker("Taillight_L", -0.5, 0.5, -2.1),
	makeMarker("Taillight_R", 0.5, 0.5, -2.1),
];

// ── Validation Tests ──

describe("validateMarkers", () => {
	it("returns empty for fully-placed markers", () => {
		const issues = validateMarkers(FULL_MARKERS);
		expect(issues).toHaveLength(0);
	});

	it("errors on missing PhysicsMarker", () => {
		const markers = FULL_MARKERS.filter((m) => m.type !== "PhysicsMarker");
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.type === "error" && i.message.includes("PhysicsMarker"))).toBe(true);
	});

	it("errors on missing wheels", () => {
		const markers = FULL_MARKERS.filter((m) => !m.type.startsWith("Wheel_"));
		const issues = validateMarkers(markers);
		const wheelError = issues.find((i) => i.message.includes("Missing wheels"));
		expect(wheelError).toBeDefined();
		expect(wheelError?.type).toBe("error");
		for (const w of ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]) {
			expect(wheelError?.message).toContain(w);
		}
	});

	it("errors on single missing wheel", () => {
		const markers = FULL_MARKERS.filter((m) => m.type !== "Wheel_RL");
		const issues = validateMarkers(markers);
		const wheelError = issues.find((i) => i.message.includes("Missing wheels"));
		expect(wheelError).toBeDefined();
		expect(wheelError?.message).toContain("Wheel_RL");
		expect(wheelError?.message).not.toContain("Wheel_FL");
	});

	it("warns on asymmetric front wheels", () => {
		const markers = [...FULL_MARKERS.filter((m) => m.type !== "Wheel_FR"), makeMarker("Wheel_FR", 0.9, 0.31, 1.3)];
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.type === "warn" && i.message.includes("Front wheels not symmetric"))).toBe(true);
	});

	it("warns on asymmetric rear wheels", () => {
		const markers = [...FULL_MARKERS.filter((m) => m.type !== "Wheel_RR"), makeMarker("Wheel_RR", 0.7, 0.31, -1.2)];
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.type === "warn" && i.message.includes("Rear wheels not symmetric"))).toBe(true);
	});

	it("accepts near-symmetric wheels (within 0.05m)", () => {
		const markers = [...FULL_MARKERS.filter((m) => m.type !== "Wheel_FR"), makeMarker("Wheel_FR", 0.83, 0.31, 1.3)];
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.message.includes("symmetric"))).toBe(false);
	});

	it("warns on suspicious wheel radius", () => {
		const markers = [
			...FULL_MARKERS.filter((m) => !m.type.startsWith("Wheel_")),
			makeMarker("Wheel_FL", -0.8, 0.1, 1.3),
			makeMarker("Wheel_FR", 0.8, 0.1, 1.3),
			makeMarker("Wheel_RL", -0.8, 0.1, -1.2),
			makeMarker("Wheel_RR", 0.8, 0.1, -1.2),
		];
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.type === "warn" && i.message.includes("Suspicious wheel radius"))).toBe(true);
	});

	it("warns on no light markers", () => {
		const markers = FULL_MARKERS.filter((m) => !m.type.startsWith("Headlight") && !m.type.startsWith("Taillight"));
		const issues = validateMarkers(markers);
		expect(issues.some((i) => i.type === "warn" && i.message.includes("No light markers"))).toBe(true);
	});

	it("does not warn when lights present", () => {
		const issues = validateMarkers(FULL_MARKERS);
		expect(issues.some((i) => i.message.includes("No light markers"))).toBe(false);
	});
});

// ── Chassis Config Generation ──

describe("generateChassisConfig", () => {
	it("generates valid chassis spec from full markers", () => {
		const config = generateChassisConfig(FULL_MARKERS);
		expect(config.mass).toBe(1200);
		expect(config.halfExtents).toHaveLength(3);
		expect(config.halfExtents[0]).toBeGreaterThan(0);
		expect(config.halfExtents[1]).toBeGreaterThan(0);
		expect(config.halfExtents[2]).toBeGreaterThan(0);
		expect(config.wheelRadius).toBeCloseTo(0.31, 1);
		expect(config.wheelPositions).toHaveLength(4);
		expect(config.wheelBase).toBeCloseTo(2.5, 1);
		expect(config.cgHeight).toBe(0.35);
	});

	it("uses physics marker Y for cgHeight", () => {
		const modified = FULL_MARKERS.map((m) =>
			m.type === "PhysicsMarker" ? makeMarker("PhysicsMarker", 0, 0.42, 0.5) : m,
		);
		const config = generateChassisConfig(modified);
		expect(config.cgHeight).toBe(0.42);
	});

	it("falls back to hardcoded default when no PhysicsMarker", () => {
		const markers = FULL_MARKERS.filter((m) => m.type !== "PhysicsMarker");
		const config = generateChassisConfig(markers);
		expect(config.cgHeight).toBe(0.35);
	});

	it("returns defaults when no wheels", () => {
		const config = generateChassisConfig([makeMarker("PhysicsMarker", 0, 0.35, 0)]);
		expect(config.halfExtents).toEqual([1, 0.5, 2]);
		expect(config.wheelRadius).toBe(0.3);
		expect(config.wheelBase).toBe(2.5);
	});
});

// ── Model Schema Generation ──

describe("generateModelSchema", () => {
	it("generates schema with wheel markers", () => {
		const schema = generateModelSchema(FULL_MARKERS);
		expect(schema.wheelModelPath).toBe("/assets/new-car/car.glb");
		expect(schema.markers.wheels).toEqual(["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]);
		expect(schema.markers.physicsMarker).toBe("PhysicsMarker");
	});

	it("includes exhaust pipes when present", () => {
		const markers = [
			...FULL_MARKERS,
			makeMarker("Exhaust_L", -0.3, 0.15, -2.1),
			makeMarker("Exhaust_R", 0.3, 0.15, -2.1),
		];
		const schema = generateModelSchema(markers);
		expect(schema.markers.escapePipes).toBeDefined();
		expect(schema.markers.escapePipes?.left).toBe("Exhaust_L");
		expect(schema.markers.escapePipes?.right).toBe("Exhaust_R");
	});

	it("omits escapePipes when no exhaust markers", () => {
		const schema = generateModelSchema(FULL_MARKERS);
		expect(schema.markers.escapePipes).toBeUndefined();
	});
});

// ── Full Export ──

describe("generateExport", () => {
	it("produces complete export payload", () => {
		const payload = generateExport("AE86", "/assets/ae86/body.glb", 2.1, FULL_MARKERS);
		expect(payload.carName).toBe("AE86");
		expect(payload.modelPath).toBe("/assets/ae86/body.glb");
		expect(payload.modelScale).toBe(2.1);
		expect(payload.chassis.mass).toBe(1200);
		expect(payload.schema.wheelModelPath).toBeDefined();
		expect(payload.markers).toHaveLength(FULL_MARKERS.length);
	});

	it("includes marker positions in export", () => {
		const payload = generateExport("Test", "/test.glb", 1, FULL_MARKERS);
		const pm = payload.markers.find((m) => m.type === "PhysicsMarker");
		expect(pm).toBeDefined();
		expect(pm?.position).toEqual({ x: 0, y: 0.35, z: 0.5 });
	});
});
