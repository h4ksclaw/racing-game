/**
 * Editor UI — wires Lit components and editor modules together.
 */
import type { DropZone } from "../ui/drop-zone.js";
import { bakeModel } from "./bake-export.js";
import { clearGhost, updateDimensions } from "./dimension-overlay.js";
import { API_BASE, getCurrentModel, handleSelectClick, init, loadGLB } from "./editor-main.js";
import { getEditorState, setCarSelection } from "./editor-state.js";
import { generateExport, validateMarkers } from "./export.js";
import { initImportFlow } from "./import-flow.js";
import { getMarkers, handleViewportClick } from "./marker-tool.js";
import { initObjectPanel, refreshObjectPanel } from "./object-panel.js";
import { getPhysicsOverrides } from "./physics-editor.js";
import type { PhysicsModal } from "./physics-modal.js";
import { getCurrentScale, initScaleControls, setScaleFromCar } from "./scale-controls.js";
import { collapseSketchfabPanel, initSketchfabPanel, loadPendingAssets } from "./sketchfab-panel.js";
import { initExportWiring } from "./wire-export.js";
import { initKeyboardWiring } from "./wire-keyboard.js";
import { initMarkerWiring } from "./wire-markers.js";
import { initObjectWiring } from "./wire-objects.js";
import { initSearchWiring } from "./wire-search.js";
import { initToolbarWiring } from "./wire-toolbar.js";

// ── DOM references ──
const viewport = document.getElementById("viewport");
const dropZone = document.querySelector("drop-zone");
const toolbar = document.querySelector("editor-toolbar");
const markerListEl = document.querySelector("marker-list");
const validationEl = document.querySelector("validation-display");
const statusLine = document.querySelector("status-line");
const sidebarAttribution = document.getElementById("sidebar-attribution") as HTMLTextAreaElement | null;
const sidebarSubmitBtn = document.getElementById("btn-submit") as HTMLButtonElement | null;

// ── Init scene ──
if (!viewport || !dropZone) {
	console.error("Editor: required DOM elements missing");
} else {
	init(viewport);
	setupDropZone(dropZone);
}

function setupDropZone(dz: DropZone): void {
	dz.addEventListener("file-drop", async (e: Event) => {
		const file = (e as CustomEvent<File>).detail;
		if (statusLine) statusLine.message = `Uploading ${file.name}...`;
		dz.setLoading(true);
		try {
			const formData = new FormData();
			formData.append("model", file);
			const resp = await fetch(`${API_BASE}/assets/upload`, {
				method: "POST",
				body: formData,
			});
			if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
			const data = await resp.json();
			if (data.hash) {
				await loadModelAndReset(`/api/assets/file/${data.hash}`, file.name.replace(/\.(glb|gltf)$/i, ""));
			}
		} catch (err) {
			if (statusLine) statusLine.message = `Upload failed: ${err}`;
			console.error("Upload failed:", err);
		} finally {
			dz.setLoading(false);
		}
	});
}

/** Load a model, clear markers, and refresh the UI. */
export async function loadModelAndReset(path: string, name: string, attribution?: string): Promise<void> {
	setCarSelection({ modelPath: path, name });
	if (statusLine) statusLine.message = `Loading ${name}...`;

	const dims = getEditorState().car.dims;
	await loadGLB(path, dims ? { dims } : undefined);

	const model = getCurrentModel();
	if (model && dims) {
		const avgScale = model.scale.x;
		if (avgScale > 0) setScaleFromCar(avgScale);
	}

	const { clearMarkers } = await import("./marker-tool.js");
	clearMarkers();
	clearGhost();
	updateDimensions();
	refreshUI();

	// Auto-populate sidebar attribution if provided
	if (attribution && sidebarAttribution) {
		sidebarAttribution.value = attribution;
	}

	if (statusLine) statusLine.message = `Loaded: ${name}`;

	// Pulse the smart/auto-detect button to draw attention
	if (toolbar) {
		const brainBtn = toolbar.shadowRoot?.querySelector('[data-action="auto-detect"]');
		if (brainBtn) {
			brainBtn.classList.remove("smart-pulse");
			void (brainBtn as HTMLElement).offsetWidth;
			brainBtn.classList.add("smart-pulse");
			brainBtn.addEventListener("animationend", () => brainBtn.classList.remove("smart-pulse"), { once: true });
		}
	}
}

// ── Wire sub-modules ──
if (toolbar) initToolbarWiring(toolbar as any);
if (markerListEl && toolbar) initMarkerWiring(markerListEl as any, toolbar as any, refreshUI);
initScaleControls();
initSketchfabPanel((path, name, attribution) => {
	collapseSketchfabPanel();
	return loadModelAndReset(path, name, attribution);
});
loadPendingAssets();

const objectPanel = document.getElementById("object-panel");
if (objectPanel) initObjectPanel(objectPanel);
initObjectWiring();
if (toolbar) initKeyboardWiring(toolbar as any);
initExportWiring();

// ── Toast notifications ──
document.addEventListener("toast", (e: Event) => {
	const { message, type = "info" } = (e as CustomEvent<{ message: string; type?: string }>).detail;
	const container = document.getElementById("toast-container");
	if (!container) return;
	const toast = document.createElement("div");
	toast.className = `toast ${type}`;
	toast.textContent = message;
	container.appendChild(toast);
	setTimeout(() => {
		toast.classList.add("out");
		toast.addEventListener("animationend", () => toast.remove());
	}, 3500);
});
initSearchWiring(loadModelAndReset);

// ── Viewport clicks ──
viewport?.addEventListener("pointerdown", (e) => {
	import("./assign-mode.js").then(({ onPointerDown }) => onPointerDown(e));
});
viewport?.addEventListener("click", (e) => {
	if (handleSelectClick(e)) return;
	// Check assign mode first
	import("./assign-mode.js").then(({ handleAssignClick }) => {
		if (handleAssignClick(e)) return;
		handleViewportClick(e);
	});
});
// Middle click for assign mode remove
viewport?.addEventListener("auxclick", (e) => {
	if (e.button === 1) {
		import("./assign-mode.js").then(({ handleAssignClick }) => handleAssignClick(e));
	}
});

// ── Sidebar Submit (bake + upload + save config) ──
type SubmitState = "idle" | "baking" | "uploading" | "saving" | "success" | "error";
const SUBMIT_LABELS: Record<SubmitState, string> = {
	idle: "Bake & Submit",
	baking: "Baking...",
	uploading: "Uploading...",
	saving: "Saving...",
	success: "✓ Saved",
	error: "✕ Failed",
};

function setSubmitState(state: SubmitState, extra?: string): void {
	if (!sidebarSubmitBtn) return;
	sidebarSubmitBtn.disabled = state !== "idle" && state !== "success" && state !== "error";
	sidebarSubmitBtn.textContent = SUBMIT_LABELS[state];
	sidebarSubmitBtn.className = "btn-primary" + (state === "success" ? " success" : state === "error" ? " error" : "");
	const errorEl = document.getElementById("export-error");
	const validEl = document.getElementById("export-validation");
	if (errorEl) {
		errorEl.textContent = state === "error" ? extra || "" : "";
		errorEl.className = "export-error" + (state === "error" && extra ? " visible" : "");
	}
	if (validEl) {
		validEl.className = "export-validation";
	}
	if (state === "success" || state === "error") setTimeout(() => setSubmitState("idle"), 4000);
}

sidebarSubmitBtn?.addEventListener("click", async () => {
	const model = getCurrentModel();
	if (!model) {
		setSubmitState("error", "No model loaded — drop a GLB or select from pending assets.");
		return;
	}

	const markers = getMarkers();
	const issues = validateMarkers(markers);
	const errors = issues.filter((i) => i.type === "error");
	if (errors.length > 0) {
		const validEl = document.getElementById("export-validation");
		if (validEl) {
			validEl.textContent = "Fix errors: " + errors.map((i) => i.message).join("; ");
			validEl.className = "export-validation visible";
		}
		return;
	}

	setSubmitState("baking");
	try {
		const bakeResult = await bakeModel(model, markers, {
			includeMarkers: true,
			applyObjectMarks: true,
			bakeScale: true,
		});
		setSubmitState("uploading");

		const state = getEditorState();
		const formData = new FormData();
		formData.append(
			"model",
			new Blob([bakeResult.glbBuffer], { type: "model/gltf-binary" }),
			`${state.car.name || "car"}.glb`,
		);
		const s3Resp = await fetch(`${API_BASE}/s3/upload`, {
			method: "POST",
			body: formData,
		});
		if (!s3Resp.ok) {
			const errBody = await s3Resp.text().catch(() => "(no body)");
			throw new Error(`S3 upload failed (${s3Resp.status}): ${errBody}`);
		}
		const { key: s3Key } = await s3Resp.json();

		setSubmitState("saving");

		const exportPayload = generateExport(state.car.name || "unnamed", `s3:${s3Key}`, getCurrentScale().x, markers);
		const physicsModal = document.querySelector("physics-modal") as PhysicsModal | null;
		const physicsOverrides = physicsModal?.getOverrides?.() ?? getPhysicsOverrides();
		const attribution = sidebarAttribution?.value || "";

		const importResp = await fetch(`${API_BASE}/cars/import`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				config: exportPayload.chassis,
				modelSchema: exportPayload.schema,
				physicsOverrides,
				attribution,
				s3Key,
			}),
		});

		if (!importResp.ok) {
			let errMsg = `HTTP ${importResp.status}`;
			try {
				const body = await importResp.json();
				if (body.error) errMsg = body.error;
			} catch {
				/* ignore */
			}
			throw new Error(errMsg);
		}
		const result = await importResp.json();
		setSubmitState("success");
		if (statusLine) statusLine.message = `Imported: ${state.car.name} (config #${result.configId})`;
	} catch (err) {
		setSubmitState("error", `Submit failed: ${err}`);
	}
});

// ── Import flow (tutorial only — no submit) ──
initImportFlow();

// ── Initial state ──
refreshUI();

function refreshUI() {
	if (markerListEl) {
		const entries = getMarkers().map((m) => ({
			id: m.id,
			type: m.type,
			position: { x: m.position.x, y: m.position.y, z: m.position.z },
			locked: m.locked,
			pairId: m.pairId,
			enabled: m.enabled,
		}));
		markerListEl.markers = entries;
	}
	if (validationEl) validationEl.issues = validateMarkers(getMarkers());
	refreshObjectPanel(getCurrentModel());
}
