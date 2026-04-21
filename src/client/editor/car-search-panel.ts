/**
 * Car database search panel — search input, results dropdown, car selection.
 */

import { clearGhost, showExpectedGhost, updateDimensions } from "./dimension-overlay.js";
import { API_BASE, loadGLB, setModelScale } from "./editor-main.js";
import { clearMarkers } from "./marker-tool.js";

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results")!;
const carInfo = document.getElementById("car-info")!;
let searchTimeout: ReturnType<typeof setTimeout>;
let onCarSelected: ((car: CarMeta) => void) | null = null;

interface CarMeta {
	name: string;
	modelPath: string;
	modelScale: number;
	weightKg: number;
	lengthM?: number;
	widthM?: number;
	heightM?: number;
}

export function initCarSearchPanel(onSelect: (car: CarMeta) => void): void {
	onCarSelected = onSelect;
	searchInput.addEventListener("input", () => {
		clearTimeout(searchTimeout);
		const q = searchInput.value.trim();
		if (q.length < 2) {
			searchResults.classList.remove("active");
			return;
		}
		searchTimeout = setTimeout(async () => {
			try {
				const resp = await fetch(`${API_BASE}/cars/search?q=${encodeURIComponent(q)}`);
				const cars = await resp.json();
				renderSearchResults(cars);
			} catch {
				/* ignore */
			}
		}, 300);
	});
	searchInput.addEventListener("blur", () => setTimeout(() => searchResults.classList.remove("active"), 200));
}

function renderSearchResults(cars: CarMeta[]) {
	searchResults.innerHTML = "";
	if (cars.length === 0) {
		searchResults.classList.remove("active");
		return;
	}
	searchResults.classList.add("active");
	for (const car of cars.slice(0, 10)) {
		const div = document.createElement("div");
		div.className = "search-item";
		div.textContent = car.name;
		div.addEventListener("mousedown", () => selectCar(car));
		searchResults.appendChild(div);
	}
}

async function selectCar(car: CarMeta) {
	searchInput.value = car.name;
	searchResults.classList.remove("active");

	carInfo.classList.add("active");
	document.getElementById("car-dims")!.textContent =
		`${car.lengthM ?? "?"} × ${car.widthM ?? "?"} × ${car.heightM ?? "?"} m`;
	document.getElementById("car-weight")!.textContent = `${car.weightKg ?? "?"} kg`;
	document.getElementById("car-model")!.textContent = car.modelPath.split("/").pop() ?? "";

	// Update scale sliders to match car's scale
	const scale = car.modelScale || 1;
	for (const axis of ["u", "x", "y", "z"]) {
		const slider = document.getElementById(`scale-${axis}`) as HTMLInputElement;
		slider.value = String(scale);
		const valEl = document.getElementById(`scale-${axis}-val`);
		if (valEl) valEl.textContent = scale.toFixed(2);
	}

	try {
		await loadGLB(car.modelPath);
		setModelScale(scale, scale, scale);
		clearMarkers();
		updateDimensions();
		if (car.lengthM && car.widthM && car.heightM) {
			showExpectedGhost(car.lengthM, car.widthM, car.heightM);
		} else {
			clearGhost();
		}
		onCarSelected?.(car);
	} catch (err) {
		console.error("Failed to load model:", err);
	}
}

export type { CarMeta };
