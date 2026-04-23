/**
 * Physics override panel — sliders for chassis physics params using SliderRow.
 */
import type { PhysicsOverrides } from "./bake-export.js";
import { getCompressionPercent, setCompressionPercent } from "./suspension-viz.js";

interface ParamDef {
	key: keyof PhysicsOverrides;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
	unit: string;
}

const PARAMS: ParamDef[] = [
	{
		key: "mass",
		label: "Mass",
		min: 500,
		max: 3000,
		step: 10,
		default: 1200,
		unit: "kg",
	},
	{
		key: "suspensionStiffness",
		label: "Susp. Stiffness",
		min: 5,
		max: 200,
		step: 1,
		default: 50,
		unit: "",
	},
	{
		key: "suspensionRestLength",
		label: "Susp. Rest Length",
		min: 0.05,
		max: 0.8,
		step: 0.01,
		default: 0.3,
		unit: "m",
	},
	{
		key: "maxSuspensionTravel",
		label: "Max Susp. Travel",
		min: 0.05,
		max: 0.5,
		step: 0.01,
		default: 0.3,
		unit: "m",
	},
	{
		key: "dampingRelaxation",
		label: "Damping Relaxation",
		min: 0.1,
		max: 10,
		step: 0.1,
		default: 2.3,
		unit: "",
	},
	{
		key: "dampingCompression",
		label: "Damping Compression",
		min: 0.1,
		max: 10,
		step: 0.1,
		default: 4.4,
		unit: "",
	},
	{
		key: "rollInfluence",
		label: "Roll Influence",
		min: 0,
		max: 0.3,
		step: 0.005,
		default: 0.1,
		unit: "",
	},
	{
		key: "maxSteerAngle",
		label: "Max Steer Angle",
		min: 0.1,
		max: 1.0,
		step: 0.01,
		default: 0.6,
		unit: "rad",
	},
	{
		key: "cgHeight",
		label: "CG Height",
		min: 0.1,
		max: 1.0,
		step: 0.01,
		default: 0.35,
		unit: "m",
	},
	{
		key: "weightFront",
		label: "Weight Front %",
		min: 0.3,
		max: 0.7,
		step: 0.01,
		default: 0.55,
		unit: "",
	},
	{
		key: "corneringStiffnessFront",
		label: "Corner. Stiff. Front",
		min: 100,
		max: 200000,
		step: 100,
		default: 80000,
		unit: "",
	},
	{
		key: "corneringStiffnessRear",
		label: "Corner. Stiff. Rear",
		min: 100,
		max: 200000,
		step: 100,
		default: 75000,
		unit: "",
	},
	{
		key: "peakFriction",
		label: "Peak Friction",
		min: 0.5,
		max: 2.0,
		step: 0.01,
		default: 1.0,
		unit: "",
	},
];

let currentOverrides: PhysicsOverrides;
let carBaseline: Partial<PhysicsOverrides> = {}; // Car-specific defaults from DB selection
const changeCallbacks: ((overrides: PhysicsOverrides) => void)[] = [];
let suspPreviewCallback: ((percent: number) => void) | null = null;

export function onSuspPreviewChange(cb: (percent: number) => void): void {
	suspPreviewCallback = cb;
}

export function createPhysicsPanel(container: HTMLElement): void {
	currentOverrides = getDefaultOverrides();
	container.innerHTML = "";

	for (const p of PARAMS) {
		const el = document.createElement("slider-row");
		el.label = p.label;
		el.value = currentOverrides[p.key];
		el.min = p.min;
		el.max = p.max;
		el.step = p.step;
		el.unit = p.unit;

		el.addEventListener("slider-input", (e: Event) => {
			currentOverrides[p.key] = (e as CustomEvent<number>).detail;
			notifyChange();
		});

		container.appendChild(el);
	}

	const sep = document.createElement("div");
	sep.style.cssText = "border-top: 1px solid var(--ui-border); margin: 4px 0;";
	container.appendChild(sep);

	const preview = document.createElement("slider-row");
	preview.label = "Susp. Preview";
	preview.value = getCompressionPercent();
	preview.min = 0;
	preview.max = 100;
	preview.step = 1;
	preview.unit = "%";

	preview.addEventListener("slider-input", (e: Event) => {
		const pct = (e as CustomEvent<number>).detail;
		setCompressionPercent(pct);
		suspPreviewCallback?.(pct);
	});

	container.appendChild(preview);
}

export function getDefaultOverrides(): PhysicsOverrides {
	const out: Record<string, number> = {};
	for (const p of PARAMS) out[p.key] = p.default;
	return out as unknown as PhysicsOverrides;
}

export function getPhysicsOverrides(): PhysicsOverrides {
	return { ...currentOverrides };
}

export function setPhysicsOverrides(overrides: Partial<PhysicsOverrides>): void {
	currentOverrides = { ...currentOverrides, ...overrides };
	notifyChange();
	const panel = document.querySelector("#physics-panel-container");
	if (!panel) return;
	const sliders = panel.querySelectorAll("slider-row");
	for (let i = 0; i < PARAMS.length; i++) {
		const p = PARAMS[i];
		const val = overrides[p.key];
		if (val !== undefined && sliders[i]) {
			sliders[i].value = val;
		}
	}
}

/** Store car-specific defaults (mass, weight distribution from DB). */
export function setCarBaseline(overrides: Partial<PhysicsOverrides>): void {
	carBaseline = { ...overrides };
}

/** Reset to car-specific defaults (falls back to generic defaults). */
export function resetToCarDefaults(): PhysicsOverrides {
	const base = getDefaultOverrides();
	currentOverrides = { ...base, ...carBaseline };
	notifyChange();
	// Update UI sliders
	const panel = document.querySelector("#physics-panel-container");
	if (panel) {
		const sliders = panel.querySelectorAll("slider-row");
		for (let i = 0; i < PARAMS.length; i++) {
			const p = PARAMS[i];
			if (sliders[i]) sliders[i].value = currentOverrides[p.key];
		}
	}
	return { ...currentOverrides };
}

export function onOverridesChange(callback: (overrides: PhysicsOverrides) => void): void {
	changeCallbacks.push(callback);
}

function notifyChange() {
	for (const cb of changeCallbacks) cb({ ...currentOverrides });
}
