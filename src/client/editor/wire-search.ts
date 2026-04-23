/**
 * Search panel wiring — connects car-search and Sketchfab panels to model loading.
 */
import type { CarResult } from "../ui/car-search.js";
import { setCarSelection } from "./editor-state.js";

function formatPrice(n: number): string {
	if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
	return `$${n}`;
}

import { Box3, Vector3 } from "three";
import { updateDimensions } from "./dimension-overlay.js";
import { getCurrentModel } from "./editor-main.js";
import { setScaleFromCar } from "./scale-controls.js";
import { searchSketchfab } from "./sketchfab-panel.js";

/**
 * Re-scale the currently loaded model to match real-world car dimensions.
 */
function rescaleModelToCar(targetDims: { length_m: number; width_m: number; height_m: number }): void {
	const model = getCurrentModel();
	if (!model) return;

	// Reset scale to identity to get true geometry size
	model.scale.set(1, 1, 1);
	model.position.set(0, 0, 0);
	model.updateMatrixWorld(true);

	const box = new Box3().setFromObject(model);
	const size = box.getSize(new Vector3());
	const modelLongest = Math.max(size.x, size.y, size.z);
	const realLongest = Math.max(targetDims.length_m, targetDims.width_m, targetDims.height_m);
	if (modelLongest <= 0 || realLongest <= 0) return;

	const finalScale = realLongest / modelLongest;
	model.scale.set(finalScale, finalScale, finalScale);
	model.updateMatrixWorld(true);

	// Re-center: sit on ground (y=0) and center X/Z
	const finalBox = new Box3().setFromObject(model);
	model.position.y -= finalBox.min.y;
	const center = finalBox.getCenter(new Vector3());
	model.position.x -= center.x;
	model.position.z -= center.z;
	model.updateMatrixWorld(true);

	setScaleFromCar(finalScale);
	updateDimensions();
	console.log(
		`[editor] Re-scaled model to match car: ${targetDims.length_m}×${targetDims.width_m}×${targetDims.height_m}m, scale=${finalScale.toFixed(4)}`,
	);
}

export function initSearchWiring(_loadModelAndReset: (path: string, name: string) => Promise<void>): void {
	const carSearchEl = document.querySelector("car-search");
	const carInfo = document.getElementById("car-info");
	const carDims = document.getElementById("car-dims");
	const carWeight = document.getElementById("car-weight");
	const carModel = document.getElementById("car-model");

	carSearchEl?.addEventListener("car-selected", ((e: CustomEvent<CarResult>) => {
		const car = e.detail;
		const name = `${car.make} ${car.model}`;
		const dims = car.dimensions;
		const parsedDims =
			dims && dims.length_m && dims.width_m && dims.height_m
				? {
						length_m: dims.length_m,
						width_m: dims.width_m,
						height_m: dims.height_m,
					}
				: null;

		setCarSelection({ name, modelPath: "", dims: parsedDims });

		// Update reference prism to match selected car dimensions
		if (parsedDims) {
			import("./editor-main.js").then(({ setRefPrismDims }) => {
				setRefPrismDims(parsedDims.length_m, parsedDims.width_m, parsedDims.height_m);
			});
		}

		// Re-scale loaded model to match real car dimensions
		if (parsedDims && getCurrentModel()) {
			rescaleModelToCar(parsedDims);
		}

		// Push car data into physics editor + store as reset baseline
		const carPhysics: Record<string, number> = {};
		if (car.weightKg) carPhysics.mass = car.weightKg!;
		if (car.weightFrontPct != null) carPhysics.weightFront = (car.weightFrontPct ?? 55) / 100;
		if (Object.keys(carPhysics).length > 0) {
			import("./physics-editor.js").then(({ setPhysicsOverrides, setCarBaseline }) => {
				setPhysicsOverrides(carPhysics as any);
				setCarBaseline(carPhysics as any);
			});
		}

		if (carInfo) carInfo.classList.add("active");
		if (carDims)
			carDims.textContent = `${dims?.length_m ?? "?"} × ${dims?.width_m ?? "?"} × ${dims?.height_m ?? "?"} m`;
		if (carWeight) carWeight.textContent = `${car.weightKg ?? "?"} kg`;
		// Price — prefer avg, then min as single representative value
		const priceEl = document.getElementById("car-price");
		if (priceEl) {
			const price = (car as any).price as { min_usd?: number; max_usd?: number; avg_usd?: number } | undefined;
			if (price?.avg_usd != null) {
				priceEl.textContent = formatPrice(price.avg_usd);
			} else if (price?.min_usd != null) {
				priceEl.textContent =
					price.min_usd === price.max_usd || price.max_usd == null
						? formatPrice(price.min_usd)
						: `${formatPrice(price.min_usd)} – ${formatPrice(price.max_usd)}`;
			} else {
				priceEl.textContent = "—";
			}
		}
		if (carModel) carModel.textContent = `${car.make} ${car.model}`;

		searchSketchfab(`${car.make} ${car.model}`);
	}) as EventListener);

	carSearchEl?.addEventListener("car-cleared", () => {
		setCarSelection({ name: "", modelPath: "", dims: null });
		if (carInfo) carInfo.classList.remove("active");
		const sfResults = document.getElementById("sf-results");
		if (sfResults) sfResults.innerHTML = "";
		const sfLabel = document.getElementById("sf-search-label");
		if (sfLabel) sfLabel.textContent = "Select a car above";
	});
}
