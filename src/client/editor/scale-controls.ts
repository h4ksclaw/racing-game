/**
 * Scale controls — uniform and per-axis scale using SliderRow Lit components.
 */
import { updateDimensions } from "./dimension-overlay.js";
import { setModelScale } from "./editor-main.js";
import { getEditorState, setCarScale } from "./editor-state.js";

export function initScaleControls(_onChange?: (scale: { x: number; y: number; z: number }) => void): void {
	const container = document.getElementById("scale-controls");
	if (!container) return;

	const axes = [
		{
			key: "u" as const,
			label: "Uniform",
			min: 0.01,
			max: 5,
			step: 0.01,
			value: 1,
		},
		{ key: "x" as const, label: "X", min: 0.01, max: 5, step: 0.01, value: 1 },
		{ key: "y" as const, label: "Y", min: 0.01, max: 5, step: 0.01, value: 1 },
		{ key: "z" as const, label: "Z", min: 0.01, max: 5, step: 0.01, value: 1 },
	];

	for (const axis of axes) {
		const el = document.createElement("slider-row");
		el.label = axis.label;
		el.value = axis.value;
		el.min = axis.min;
		el.max = axis.max;
		el.step = axis.step;

		el.addEventListener("slider-input", (e: Event) => {
			applyScale((e as CustomEvent<number>).detail, axis.key, container);
		});

		container.appendChild(el);
	}
}

function applyScale(val: number, changed: string, container: HTMLElement) {
	const sliders = container.querySelectorAll("slider-row");
	const scale = getEditorState().car.scale;

	if (changed === "u") {
		setCarScale(val, val, val);
		for (let i = 1; i <= 3; i++) sliders[i].value = val;
	} else {
		(scale as Record<string, number>)[changed] = val;
		setCarScale(scale.x, scale.y, scale.z);
	}
	setModelScale(scale.x, scale.y, scale.z);
	updateDimensions();
}

export function setScaleFromCar(scale: number): void {
	setCarScale(scale, scale, scale);
	setModelScale(scale, scale, scale);
	const container = document.getElementById("scale-controls");
	if (!container) return;
	const sliders = container.querySelectorAll("slider-row");
	for (const s of sliders) s.value = scale;
}

export function getCurrentScale() {
	return getEditorState().car.scale;
}
