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
	currentConfigId = null; // reset — new model, not editing existing
	if (sidebarSubmitBtn) sidebarSubmitBtn.textContent = "Bake & Submit";
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
	if (state === "error") setTimeout(() => setSubmitState("idle"), 4000);
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
		currentConfigId = result.configId;
		setSubmitState("success");
		if (sidebarSubmitBtn) sidebarSubmitBtn.textContent = "Bake & Overwrite";
		if (statusLine) statusLine.message = `Imported: ${state.car.name} (config #${result.configId})`;
		loadExistingCars(); // refresh the list
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

// ── Current car config ID (for re-submit overwrite) ──
let currentConfigId: number | null = null;

// ── Suspension Test Slider ──
const suspSlider = document.getElementById("suspension-slider") as HTMLInputElement | null;
const suspValue = document.getElementById("suspension-value");
let lastSuspOffset = 0;
if (suspSlider) {
	suspSlider.addEventListener("input", () => {
		const newOffset = parseFloat(suspSlider.value);
		const delta = newOffset - lastSuspOffset;
		lastSuspOffset = newOffset;
		import("./marker-tool.js").then(({ applySuspensionOffset }) => {
			applySuspensionOffset(delta);
		});
		if (suspValue) suspValue.textContent = `${newOffset >= 0 ? "+" : ""}${newOffset.toFixed(2)}m`;
	});
	suspSlider.addEventListener("dblclick", () => {
		suspSlider.value = "0";
		const delta = -lastSuspOffset;
		lastSuspOffset = 0;
		if (suspValue) suspValue.textContent = "0.00m";
		import("./marker-tool.js").then(({ applySuspensionOffset }) => applySuspensionOffset(delta));
	});
}

// ── Load Existing Cars ──
const existingCarsList = document.getElementById("existing-cars-list");
async function loadExistingCars(): Promise<void> {
	if (!existingCarsList) return;
	try {
		const resp = await fetch(`${API_BASE}/cars/imported`);
		if (!resp.ok) return;
		const cars: {
			id: number;
			name: string;
			status: string;
			s3Key?: string;
			createdAt: string;
			attribution: string | null;
		}[] = await resp.json();
		if (cars.length === 0) {
			existingCarsList.innerHTML = '<div style="color:var(--ui-text-dim);padding:4px 0;">No imported cars yet</div>';
			return;
		}
		existingCarsList.innerHTML = cars
			.map(
				(c) =>
					`<div class="existing-car-item" data-config-id="${c.id}" data-s3-key="${c.s3Key ?? ""}" style="padding:4px 6px;cursor:pointer;border-radius:3px;border:1px solid var(--ui-border);margin-bottom:3px;transition:background 0.1s;">
						<div style="color:var(--ui-text-bright);font-weight:500;">${c.name}</div>
						<div style="color:var(--ui-text-dim);font-size:9px;">#${c.id} · ${c.createdAt?.slice(0, 10)}${c.attribution ? ` · ${c.attribution.slice(0, 40)}` : ""}</div>
					</div>`,
			)
			.join("");

		// Wire click handlers
		existingCarsList.querySelectorAll(".existing-car-item").forEach((el) => {
			const item = el as HTMLElement;
			item.addEventListener("mouseenter", () => (item.style.background = "var(--ui-accent-ghost)"));
			item.addEventListener("mouseleave", () => (item.style.background = ""));
			el.addEventListener("click", async () => {
				const configId = parseInt((el as HTMLElement).dataset.configId ?? "0");
				const s3Key = (el as HTMLElement).dataset.s3Key ?? "";
				if (!configId || !s3Key) return;

				// Load the car config for editing
				try {
					const configResp = await fetch(`${API_BASE}/cars/imported/${configId}`);
					if (!configResp.ok) throw new Error(`HTTP ${configResp.status}`);
					const data = await configResp.json();

					currentConfigId = configId;
					// Resolve display name: metadata > attribution > fallback
					const carName =
						data.carName || data.attribution?.replace(/^"|"$/g, "").split(" by ")[0]?.trim() || `Car #${configId}`;

					setCarSelection({
						modelPath: `/api/assets/s3/${s3Key}`,
						name: carName,
					});

					if (statusLine) statusLine.message = `Loading ${carName} for editing (#${configId})...`;

					// Load the GLB
					await loadGLB(`/api/assets/s3/${s3Key}`);
					const { clearMarkers } = await import("./marker-tool.js");
					clearMarkers();
					clearGhost();
					updateDimensions();

					// Restore markers from schema markerPositions, or reconstruct from config
					if (data.schema?.markerPositions) {
						const { placeMarker } = await import("./marker-tool.js");
						const { Vector3 } = await import("three");
						for (const [type, pos] of Object.entries(data.schema.markerPositions)) {
							const p = pos as { x: number; y: number; z: number };
							placeMarker(type, new Vector3(p.x, p.y, p.z));
						}
					} else if (data.config?.wheelPositions && data.schema?.markers) {
						// Fallback: reconstruct from saved wheel positions + marker names
						const { placeMarker } = await import("./marker-tool.js");
						const { Vector3 } = await import("three");
						const { markers: markerNames } = data.schema;
						// PhysicsMarker at center of bounding box (estimated)
						const wheelPos = data.config.wheelPositions as Array<{ x: number; y: number; z: number }>;
						if (wheelPos.length >= 4) {
							const cx = (wheelPos[0].x + wheelPos[1].x) / 2;
							const cy = wheelPos[0].y;
							const cz = (wheelPos[0].z + wheelPos[2].z) / 2;
							placeMarker("PhysicsMarker", new Vector3(cx, cy, cz));
						}
						// Wheels from saved positions
						const wheelNames = markerNames.wheels as string[];
						wheelNames.forEach((name: string, i: number) => {
							if (wheelPos[i]) {
								placeMarker(name, new Vector3(wheelPos[i].x, wheelPos[i].y, wheelPos[i].z));
							}
						});
						// Exhaust pipes
						if (markerNames.escapePipes) {
							const ep = markerNames.escapePipes as { left?: string; right?: string };
							// Estimate exhaust positions: rear of car, below, offset left/right
							const rearZ = Math.min(...wheelPos.map((w) => w.z));
							const exY = wheelPos[0].y - 0.15;
							if (ep.left) placeMarker(ep.left, new Vector3(0.25, exY, rearZ - 0.1));
							if (ep.right) placeMarker(ep.right, new Vector3(-0.25, exY, rearZ - 0.1));
						}
					}

					// Restore physics overrides if available
					if (data.physicsOverrides) {
						const { setPhysicsOverrides } = await import("./physics-editor.js");
						setPhysicsOverrides(data.physicsOverrides);
					}

					// Restore attribution
					if (data.attribution && sidebarAttribution) sidebarAttribution.value = data.attribution;

					// Update submit button to show overwrite
					if (sidebarSubmitBtn) sidebarSubmitBtn.textContent = "Bake & Overwrite";
					if (statusLine) statusLine.message = `Editing: ${carName} (#${configId})`;

					refreshUI();
				} catch (err) {
					console.error("[editor] Failed to load car for editing:", err);
					if (statusLine) statusLine.message = `Failed to load car #${configId}`;
				}
			});
		});
	} catch {
		existingCarsList.innerHTML = '<div style="color:var(--ui-text-dim);padding:4px 0;">Failed to load</div>';
	}
}
loadExistingCars();

// Reload existing cars list after successful submit
// ── Test in Practice ──
const testPracticeBtn = document.getElementById("btn-test-practice");
testPracticeBtn?.addEventListener("click", () => {
	// TODO: Admin-only guard — only allow testing for admin users
	if (currentConfigId) {
		window.open(`/practice?car=${currentConfigId}`, "_blank");
	} else {
		// No config ID yet — prompt to submit first
		if (statusLine) statusLine.message = "Submit the car first, then test in practice.";
	}
});
