/**
 * Physics override panel — sliders/inputs for chassis physics params.
 */
import type { PhysicsOverrides } from "./bake-export.js";

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
	{ key: "mass", label: "Mass", min: 500, max: 3000, step: 10, default: 1200, unit: "kg" },
	{ key: "suspensionStiffness", label: "Susp. Stiffness", min: 5, max: 200, step: 1, default: 50, unit: "" },
	{ key: "suspensionRestLength", label: "Susp. Rest Length", min: 0.05, max: 0.8, step: 0.01, default: 0.3, unit: "m" },
	{ key: "maxSuspensionTravel", label: "Max Susp. Travel", min: 0.05, max: 0.5, step: 0.01, default: 0.3, unit: "m" },
	{ key: "dampingRelaxation", label: "Damping Relaxation", min: 0.1, max: 10, step: 0.1, default: 2.3, unit: "" },
	{ key: "dampingCompression", label: "Damping Compression", min: 0.1, max: 10, step: 0.1, default: 4.4, unit: "" },
	{ key: "rollInfluence", label: "Roll Influence", min: 0, max: 0.3, step: 0.005, default: 0.1, unit: "" },
	{ key: "maxSteerAngle", label: "Max Steer Angle", min: 0.1, max: 1.0, step: 0.01, default: 0.6, unit: "rad" },
	{ key: "cgHeight", label: "CG Height", min: 0.1, max: 1.0, step: 0.01, default: 0.35, unit: "m" },
	{ key: "weightFront", label: "Weight Front %", min: 0.3, max: 0.7, step: 0.01, default: 0.55, unit: "" },
	{
		key: "corneringStiffnessFront",
		label: "Cornering Stiff. Front",
		min: 100,
		max: 200000,
		step: 100,
		default: 80000,
		unit: "",
	},
	{
		key: "corneringStiffnessRear",
		label: "Cornering Stiff. Rear",
		min: 100,
		max: 200000,
		step: 100,
		default: 75000,
		unit: "",
	},
	{ key: "peakFriction", label: "Peak Friction", min: 0.5, max: 2.0, step: 0.01, default: 1.0, unit: "" },
];

let currentOverrides: PhysicsOverrides;
const changeCallbacks: ((overrides: PhysicsOverrides) => void)[] = [];

export function createPhysicsPanel(container: HTMLElement): void {
	currentOverrides = getDefaultOverrides();
	container.innerHTML = "";

	const style = document.createElement("style");
	style.textContent = `
		.physics-panel { display: flex; flex-direction: column; gap: 6px; }
		.physics-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
		.physics-row label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg, #ccc); }
		.physics-row input[type=range] { width: 80px; accent-color: var(--accent, #4a9eff); }
		.physics-row .val { width: 52px; text-align: right; font-family: monospace; color: var(--muted, #888); font-size: 10px; }
	`;
	container.appendChild(style);

	const panel = document.createElement("div");
	panel.className = "physics-panel";

	for (const p of PARAMS) {
		const row = document.createElement("div");
		row.className = "physics-row";

		const label = document.createElement("label");
		label.textContent = p.label;
		label.title = `${p.label} (${p.unit})`;

		const slider = document.createElement("input");
		slider.type = "range";
		slider.min = String(p.min);
		slider.max = String(p.max);
		slider.step = String(p.step);
		slider.value = String(currentOverrides[p.key]);

		const val = document.createElement("span");
		val.className = "val";
		val.textContent = `${currentOverrides[p.key]}${p.unit ? ` ${p.unit}` : ""}`;

		slider.addEventListener("input", () => {
			const v = parseFloat(slider.value);
			currentOverrides[p.key] = v;
			val.textContent = `${v}${p.unit ? ` ${p.unit}` : ""}`;
			notifyChange();
		});

		row.appendChild(label);
		row.appendChild(slider);
		row.appendChild(val);
		panel.appendChild(row);
	}

	container.appendChild(panel);
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
	// Update sliders if they exist
	const panel = document.querySelector(".physics-panel");
	if (!panel) return;
	const rows = panel.querySelectorAll(".physics-row");
	PARAMS.forEach((p, i) => {
		if (overrides[p.key] !== undefined && rows[i]) {
			const slider = rows[i].querySelector("input[type=range]") as HTMLInputElement;
			const val = rows[i].querySelector(".val") as HTMLSpanElement;
			if (slider) slider.value = String(overrides[p.key]);
			if (val) val.textContent = `${overrides[p.key]}${p.unit ? ` ${p.unit}` : ""}`;
		}
	});
}

export function onOverridesChange(callback: (overrides: PhysicsOverrides) => void): void {
	changeCallbacks.push(callback);
}

function notifyChange() {
	for (const cb of changeCallbacks) cb({ ...currentOverrides });
}
