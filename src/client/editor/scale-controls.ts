/**
 * Scale controls — uniform and per-axis scale slider wiring.
 */

import { updateDimensions } from "./dimension-overlay.js";
import { setModelScale } from "./editor-main.js";

let currentScale = { x: 1, y: 1, z: 1 };
let onScaleChanged: ((scale: typeof currentScale) => void) | null = null;

export function initScaleControls(onChange?: (scale: typeof currentScale) => void): void {
	onScaleChanged = onChange ?? null;
	for (const axis of ["u", "x", "y", "z"] as const) {
		const slider = document.getElementById(`scale-${axis}`) as HTMLInputElement;
		slider.addEventListener("input", () => {
			const val = parseFloat(slider.value);
			document.getElementById(`scale-${axis}-val`)!.textContent = val.toFixed(2);
			applyScale(val, axis);
		});
	}
}

function applyScale(val: number, changed: string) {
	if (changed === "u") {
		currentScale = { x: val, y: val, z: val };
		for (const a of ["x", "y", "z"]) {
			(document.getElementById(`scale-${a}`) as HTMLInputElement).value = String(val);
			document.getElementById(`scale-${a}-val`)!.textContent = val.toFixed(2);
		}
	} else {
		(currentScale as Record<string, number>)[changed] = val;
	}
	setModelScale(currentScale.x, currentScale.y, currentScale.z);
	updateDimensions();
	onScaleChanged?.(currentScale);
}

export function setScaleFromCar(scale: number): void {
	currentScale = { x: scale, y: scale, z: scale };
}

export function getCurrentScale() {
	return currentScale;
}
