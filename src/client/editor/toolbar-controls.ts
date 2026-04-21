/**
 * Toolbar controls — mode buttons, wireframe/dims/autodetect toggles.
 */
import * as THREE from "three";
import { type AutoDetectResult, autoDetect } from "./auto-detect.js";
import { getCamera, getCurrentModel, getOrbitControls, setMode, toggleDims, toggleWireframe } from "./editor-main.js";
import { getMarkers, getMarkerTypes, placeMarker, setPendingType } from "./marker-tool.js";
import { fitCameraToModel, setViewPreset } from "./view-controls.js";

const toolbarBtns = document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-mode]");

export function initToolbarControls(): void {
	for (const btn of toolbarBtns) {
		btn.addEventListener("click", () => {
			for (const b of toolbarBtns) b.classList.remove("active");
			btn.classList.add("active");
			setMode(btn.dataset.mode as "orbit" | "select" | "place" | "move" | "delete");
			if (btn.dataset.mode === "place") {
				setPendingType(getNextMissingMarkerType());
			} else {
				setPendingType(null);
			}
		});
	}

	document.getElementById("btn-wireframe")?.addEventListener("click", function () {
		this.classList.toggle("active");
		toggleWireframe();
	});

	document.getElementById("btn-dims")?.addEventListener("click", function () {
		this.classList.toggle("active");
		toggleDims();
		updateDimensions();
	});

	document.getElementById("btn-autodetect")?.addEventListener("click", () => {
		const model = getCurrentModel();
		if (!model) return;
		applyAutoDetect(autoDetect(model));
	});

	// View preset buttons
	for (const view of ["front", "back", "top", "left", "right"] as const) {
		const btn = document.getElementById(`btn-view-${view}`);
		if (!btn) continue;
		btn.addEventListener("click", () => {
			const model = getCurrentModel();
			if (!model) return;
			const box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			setViewPreset(view, getCamera(), getOrbitControls(), center);
		});
	}

	document.getElementById("btn-fit")?.addEventListener("click", () => {
		const model = getCurrentModel();
		if (!model) return;
		fitCameraToModel(getCamera(), getOrbitControls(), model);
	});
}

function getNextMissingMarkerType(): string {
	const markers = getMarkers();
	const types = getMarkerTypes();
	for (const t of types) {
		if (!markers.find((m) => m.type === t)) return t;
	}
	return "PhysicsMarker";
}

function updateDimensions() {
	// Dynamic import to avoid circular dep
	import("./dimension-overlay.js").then((m) => m.updateDimensions());
}

function applyAutoDetect(result: AutoDetectResult) {
	for (const w of result.wheels) placeMarker(w.type, w.position);
	for (const l of result.lights) placeMarker(l.type, l.position);
	for (const e of result.exhausts) placeMarker(e.type, e.position);
}
