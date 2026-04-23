/**
 * Tests for marker-tool.ts — symmetric pairs, lock/unlock, optional markers, auto-place.
 */

import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock THREE ──
vi.mock("three", () => ({
	Vector3: class {
		x = 0;
		y = 0;
		z = 0;
		constructor(x?: number, y?: number, z?: number) {
			this.x = x ?? 0;
			this.y = y ?? 0;
			this.z = z ?? 0;
		}
		clone() {
			return new (this.constructor as any)(this.x, this.y, this.z);
		}
		copy(other: any) {
			this.x = other.x ?? 0;
			this.y = other.y ?? 0;
			this.z = other.z ?? 0;
			return this;
		}
		set(x: number, y: number, z: number) {
			this.x = x;
			this.y = y;
			this.z = z;
			return this;
		}
	},
	Mesh: class {
		isMesh = true;
		userData: any = {};
		visible = true;
		renderOrder = 0;
		parent: any = null;
		position: any;
		constructor() {
			this.position = {
				x: 0,
				y: 0,
				z: 0,
				copy: (v: any) => {
					this.position.x = v.x;
					this.position.y = v.y;
					this.position.z = v.z;
					return this.position;
				},
			};
		}
	} as any,
	MeshStandardMaterial: class {
		color = 0;
		emissive = 0;
		emissiveIntensity = 0;
		depthTest = true;
		constructor(opts?: any) {
			if (opts?.color) this.color = opts.color;
			if (opts?.emissive) this.emissive = opts.emissive;
			if (opts?.emissiveIntensity !== undefined) this.emissiveIntensity = opts.emissiveIntensity;
			if (opts?.depthTest !== undefined) this.depthTest = opts.depthTest;
		}
	},
	SphereGeometry: class {},
	Box3: class {},
	Raycaster: class {
		setFromCamera() {}
		intersectObject() {
			return [];
		}
		intersectObjects() {
			return [];
		}
	},
	Vector2: class {
		x = 0;
		y = 0;
		constructor(x?: number, y?: number) {
			this.x = x ?? 0;
			this.y = y ?? 0;
		}
	},
}));

// ── Mock editor-main ──
const mockScene = { add: vi.fn(), remove: vi.fn() };
const mockTc = {
	attach: vi.fn(),
	detach: vi.fn(),
	addEventListener: vi.fn(),
	object: null,
	getHelper: vi.fn(() => ({ visible: false })),
};

vi.mock("./editor-main.js", () => ({
	getCamera: vi.fn(() => ({})),
	getCurrentModel: vi.fn(() => null),
	getModelCenter: vi.fn(() => ({ x: 0, y: 0.25, z: 0 })),
	getMode: vi.fn(() => "orbit"),
	getRenderer: vi.fn(() => ({
		domElement: {
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				width: 800,
				height: 600,
			}),
		},
	})),
	getScene: vi.fn(() => mockScene),
	getTransformControls: vi.fn(() => mockTc),
}));

import {
	clearMarkers,
	getMarkers,
	getMirrorType,
	getNextUnplacedType,
	isOptionalType,
	isPairedType,
	onMarkersChange,
	placeMarker,
	placeMarkerPair,
	removeMarker,
	toggleMarkerEnabled,
	toggleMarkerLock,
} from "./marker-tool.js";

beforeEach(() => {
	clearMarkers();
	vi.clearAllMocks();
});

// ── placeMarker ──

describe("placeMarker", () => {
	it("places a single marker with default options", () => {
		const m = placeMarker("Exhaust_R", new THREE.Vector3(-0.8, 0.3, 1.2), {
			skipPair: true,
		});
		expect(m.type).toBe("Exhaust_R");
		expect(m.enabled).toBe(true);
		expect(m.locked).toBe(true);
		expect(getMarkers()).toHaveLength(1);
	});

	it("replaces existing marker of same type", () => {
		placeMarker("Exhaust_R", new THREE.Vector3(-0.8, 0.3, 1.2), {
			skipPair: true,
		});
		placeMarker("Exhaust_R", new THREE.Vector3(-0.9, 0.3, 1.3), {
			skipPair: true,
		});
		expect(getMarkers()).toHaveLength(1);
		expect(getMarkers()[0].position.x).toBeCloseTo(-0.9);
	});

	it("respects enabled option", () => {
		const m = placeMarker("Wheel_FL", new THREE.Vector3(0, 0, 0), {
			enabled: false,
		});
		expect(m.enabled).toBe(false);
	});

	it("with skipPair, does not create mirror", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(-0.8, 0.3, 1.2), {
			skipPair: true,
		});
		expect(getMarkers()).toHaveLength(1);
	});

	it("without skipPair, auto-creates non-optional mirror", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(-0.8, 0.3, 1.2));
		expect(getMarkers()).toHaveLength(2);
		expect(getMarkers()[1].type).toBe("Wheel_FR");
	});

	it("does not auto-create mirror for optional types", () => {
		placeMarker("Exhaust_L", new THREE.Vector3(-0.3, 0.15, -2.0));
		expect(getMarkers()).toHaveLength(1);
	});

	it("links existing mirror when second is placed without skipPair", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(-0.8, 0.3, 1.2), {
			skipPair: true,
		});
		placeMarker("Wheel_FR", new THREE.Vector3(0.8, 0.3, 1.2));
		const fl = getMarkers().find((m) => m.type === "Wheel_FL");
		const fr = getMarkers().find((m) => m.type === "Wheel_FR");
		expect(fl?.pairId).toBe(fr?.id);
		expect(fr?.pairId).toBe(fl?.id);
	});
});

// ── getNextUnplacedType ──

describe("getNextUnplacedType", () => {
	it("returns first type when nothing placed", () => {
		expect(getNextUnplacedType()).toBe("Wheel_FL");
	});

	it("skips placed types", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(0, 0, 0), { skipPair: true });
		expect(getNextUnplacedType()).toBe("Wheel_FR");
	});

	it("returns optional types after all non-optional placed", () => {
		const nonOptional = [
			"Wheel_FL",
			"Wheel_FR",
			"Wheel_RL",
			"Wheel_RR",
			"Exhaust_L",
			"Headlight_L",
			"Headlight_R",
			"Taillight_L",
			"Taillight_R",
		];
		for (const t of nonOptional) {
			placeMarker(t, new THREE.Vector3(0, 0, 0), { skipPair: true });
		}
		expect(getNextUnplacedType()).toBe("Exhaust_R");
	});

	it("returns null when all placed", () => {
		const all = [
			"Wheel_FL",
			"Wheel_FR",
			"Wheel_RL",
			"Wheel_RR",
			"Exhaust_L",
			"Exhaust_R",
			"Headlight_L",
			"Headlight_R",
			"Taillight_L",
			"Taillight_R",
		];
		for (const t of all) {
			placeMarker(t, new THREE.Vector3(0, 0, 0), { skipPair: true });
		}
		expect(getNextUnplacedType()).toBeNull();
	});
});

// ── placeMarkerPair ──

describe("placeMarkerPair", () => {
	it("places a marker at origin", () => {
		const m = placeMarkerPair("Wheel_FL");
		expect(m.type).toBe("Wheel_FL");
		expect(m.position.x).toBe(0);
		expect(m.position.y).toBe(0);
		expect(m.position.z).toBe(0);
	});
});

// ── toggleMarkerLock ──

describe("toggleMarkerLock", () => {
	it("toggles lock on both markers in a pair", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(-0.8, 0.3, 1.2));
		const fl = getMarkers().find((m) => m.type === "Wheel_FL")!;
		expect(fl.locked).toBe(true);
		const result = toggleMarkerLock(fl.id);
		expect(result).toBe(false);
		const fr = getMarkers().find((m) => m.type === "Wheel_FR")!;
		expect(fr.locked).toBe(false);
	});

	it("returns false for unpaired marker", () => {
		const m = placeMarker("Wheel_FL", new THREE.Vector3(0, 0, 0), {
			skipPair: true,
		});
		expect(toggleMarkerLock(m.id)).toBe(false);
	});

	it("returns false for non-existent id", () => {
		expect(toggleMarkerLock("nonexistent")).toBe(false);
	});
});

// ── toggleMarkerEnabled ──

describe("toggleMarkerEnabled", () => {
	it("toggles enabled state and mesh visibility", () => {
		const m = placeMarker("Exhaust_R", new THREE.Vector3(0, 0, 0), {
			skipPair: true,
		});
		expect(m.enabled).toBe(true);
		const result = toggleMarkerEnabled(m.id);
		expect(result).toBe(false);
		expect(m.mesh.visible).toBe(false);
	});

	it("toggles back to enabled", () => {
		const m = placeMarker("Exhaust_R", new THREE.Vector3(0, 0, 0), {
			skipPair: true,
		});
		toggleMarkerEnabled(m.id);
		const result = toggleMarkerEnabled(m.id);
		expect(result).toBe(true);
		expect(m.mesh.visible).toBe(true);
	});

	it("returns false for non-existent id", () => {
		expect(toggleMarkerEnabled("nonexistent")).toBe(false);
	});
});

// ── Helper functions ──

describe("isPairedType / getMirrorType / isOptionalType", () => {
	it("knows paired types", () => {
		expect(isPairedType("Wheel_FL")).toBe(true);
		expect(isPairedType("Exhaust_L")).toBe(true);
	});

	it("returns mirror type", () => {
		expect(getMirrorType("Wheel_FL")).toBe("Wheel_FR");
		expect(getMirrorType("Wheel_FR")).toBe("Wheel_FL");
	});

	it("identifies optional types", () => {
		expect(isOptionalType("Exhaust_R")).toBe(true);
		expect(isOptionalType("Wheel_FL")).toBe(false);
	});
});

// ── removeMarker ──

describe("removeMarker", () => {
	it("unlinks pair when removing one side", () => {
		placeMarker("Wheel_FL", new THREE.Vector3(-0.8, 0.3, 1.2));
		const fl = getMarkers().find((m) => m.type === "Wheel_FL")!;
		removeMarker(fl.id);
		const fr = getMarkers().find((m) => m.type === "Wheel_FR")!;
		expect(fr.pairId).toBeNull();
		expect(fr.locked).toBe(false);
	});
});

// ── onMarkersChange ──

describe("onMarkersChange", () => {
	it("fires callback on marker changes", () => {
		const cb = vi.fn();
		onMarkersChange(cb);
		placeMarker("Wheel_FL", new THREE.Vector3(0, 0, 0), { skipPair: true });
		expect(cb).toHaveBeenCalledTimes(1);
	});
});
