/**
 * Editor UI — thin orchestrator that wires all editor modules to the DOM.
 */

import type { CarMeta } from "./car-search-panel.js";
import { initCarSearchPanel } from "./car-search-panel.js";
import { clearGhost, updateDimensions } from "./dimension-overlay.js";
import {
	API_BASE,
	getCurrentModel,
	handleSelectClick,
	init,
	loadGLB,
	setMode,
	setSelectedObjectUUID,
} from "./editor-main.js";
import { downloadJSON, generateExport, saveConfig, validateMarkers } from "./export.js";
import { initImportFlow } from "./import-flow.js";
import {
	clearMarkers,
	getMarkers,
	handleViewportClick,
	onMarkersChange,
	removeMarker,
	setPendingType,
} from "./marker-tool.js";
import {
	deleteObject as deleteModelObject,
	duplicateMaterialForObject,
	markObjectAs,
	toggleObjectVisibility,
} from "./object-manager.js";
import { initObjectPanel, onObjectDelete, onObjectMark, onObjectSelect, refreshObjectPanel } from "./object-panel.js";
import { getPhysicsOverrides, onSuspPreviewChange } from "./physics-editor.js";
import { getCurrentScale, initScaleControls, setScaleFromCar } from "./scale-controls.js";
import { initSketchfabPanel, loadPendingAssets } from "./sketchfab-panel.js";
import { updatePreview } from "./suspension-viz.js";
import { initToolbarControls } from "./toolbar-controls.js";

// ── State ──
let currentCarName = "";
let currentModelPath = "";

// ── Init scene ──
const viewport = document.getElementById("viewport")!;
init(viewport);

// ── File upload ──
const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
	e.preventDefault();
	dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
	e.preventDefault();
	dropZone.classList.remove("drag-over");
	const file = e.dataTransfer?.files[0];
	if (file) uploadFile(file);
});
fileInput.addEventListener("change", () => {
	if (fileInput.files?.[0]) uploadFile(fileInput.files[0]);
});

async function uploadFile(file: File) {
	const formData = new FormData();
	formData.append("model", file);
	try {
		const resp = await fetch(`${API_BASE}/assets/upload`, { method: "POST", body: formData });
		const data = await resp.json();
		if (data.hash) {
			await loadModelAndReset(`/api/assets/file/${data.hash}`, file.name.replace(/\.(glb|gltf)$/i, ""));
		}
	} catch (err) {
		console.error("Upload failed:", err);
	}
}

/** Load a model, clear markers, and refresh the UI. */
export async function loadModelAndReset(path: string, name: string): Promise<void> {
	currentModelPath = path;
	currentCarName = name;
	await loadGLB(path);
	clearMarkers();
	clearGhost();
	updateDimensions();
	refreshUI();
}

// ── Sketchfab panel ──
initSketchfabPanel((path, name) => loadModelAndReset(path, name));
loadPendingAssets();

// ── Car search panel ──
initCarSearchPanel((car: CarMeta) => {
	currentCarName = car.name;
	currentModelPath = car.modelPath;
	setScaleFromCar(car.modelScale || 1);
	refreshUI();
});

// ── Scale controls ──
initScaleControls();

// ── Toolbar ──
initToolbarControls();

// ── Object panel ──
initObjectPanel(document.getElementById("object-panel")!);
onObjectSelect((uuid) => setSelectedObjectUUID(uuid));
onObjectMark((uuid, type) => {
	const model = getCurrentModel();
	if (!model) return;
	if (type === "_toggleVis") toggleObjectVisibility(model, uuid);
	else if (type === "_dupMat") {
		const obj = model.getObjectByProperty("uuid", uuid);
		if (obj) duplicateMaterialForObject(obj, `bloom_${obj.name || "material"}`);
	} else markObjectAs(model, uuid, type);
	refreshObjectPanel(model);
});
onObjectDelete((uuid) => {
	const model = getCurrentModel();
	if (!model) return;
	deleteModelObject(model, uuid);
	refreshObjectPanel(model);
});

// ── Viewport clicks ──
viewport.addEventListener("click", (e) => {
	if (handleSelectClick(e)) return;
	handleViewportClick(e);
});

// ── Marker list ──
const toolbarBtns = document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-mode]");

onMarkersChange(() => {
	refreshMarkerList();
	refreshValidation();
});

function refreshMarkerList() {
	const list = document.getElementById("marker-list")!;
	list.innerHTML = "";
	const markers = getMarkers();
	const typeOrder = [
		"PhysicsMarker",
		"Wheel_FL",
		"Wheel_FR",
		"Wheel_RL",
		"Wheel_RR",
		"Headlight_L",
		"Headlight_R",
		"Taillight_L",
		"Taillight_R",
		"Exhaust_L",
		"Exhaust_R",
	];
	const colors: Record<string, string> = {
		PhysicsMarker: "#4a9eff",
		Wheel_FL: "#4aff8b",
		Wheel_FR: "#8bff4a",
		Wheel_RL: "#4aff8b",
		Wheel_RR: "#8bff4a",
		Headlight_L: "#ffffff",
		Headlight_R: "#ffffff",
		Taillight_L: "#ff2222",
		Taillight_R: "#ff2222",
		Exhaust_L: "#ff8844",
		Exhaust_R: "#ff8844",
	};
	const sorted = [...markers].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
	for (const m of sorted) {
		const div = document.createElement("div");
		div.className = "marker-item";
		div.innerHTML = `
			<span class="marker-dot" style="background:${colors[m.type] ?? "#ff00ff"}"></span>
			<span class="marker-name">${m.type}</span>
			<span class="marker-pos">${m.position.x.toFixed(2)}, ${m.position.y.toFixed(2)}, ${m.position.z.toFixed(2)}</span>
			<button class="marker-btn" data-action="place" data-type="${m.type}">↻</button>
			<button class="marker-btn del" data-action="delete" data-id="${m.id}">✕</button>
		`;
		div.querySelector("[data-action=place]")?.addEventListener("click", () => {
			setPendingType(m.type);
			setMode("place");
			for (const b of toolbarBtns) b.classList.toggle("active", b.dataset.mode === "place");
		});
		div.querySelector("[data-action=delete]")?.addEventListener("click", () => removeMarker(m.id));
		list.appendChild(div);
	}
}

function refreshValidation() {
	const div = document.getElementById("validation")!;
	const issues = validateMarkers(getMarkers());
	if (issues.length === 0) {
		div.innerHTML = '<div class="val-item ok">✓ All checks passed</div>';
		return;
	}
	div.innerHTML = issues
		.map((i) => `<div class="val-item ${i.type}">${i.type === "error" ? "✕" : "⚠"} ${i.message}</div>`)
		.join("");
}

// ── Export ──
document.getElementById("btn-export")?.addEventListener("click", async () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, getCurrentScale().x, getMarkers());
	const result = await saveConfig(payload);
	if (result.ok) alert("Config saved!");
	else alert(`Save failed: ${result.error}`);
});

document.getElementById("btn-download")?.addEventListener("click", () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, getCurrentScale().x, getMarkers());
	downloadJSON(payload);
});

// ── Import flow ──
initImportFlow({
	carName: currentCarName,
	modelPath: currentModelPath,
	modelScale: getCurrentScale().x,
	sketchfabAttribution: "",
	carMetadataId: null,
});

// ── Suspension preview callback ──
onSuspPreviewChange(() => {
	const model = getCurrentModel();
	if (model) updatePreview(getMarkers(), getPhysicsOverrides());
});

// ── Initial UI state ──
refreshUI();

function refreshUI() {
	refreshMarkerList();
	refreshValidation();
	refreshObjectPanel(getCurrentModel());
}
