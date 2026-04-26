/**
 * Editor UI — wires Lit components and editor modules together.
 */
import { bakeModel } from "./bake-export.js";
import { clearGhost, updateDimensions } from "./dimension-overlay.js";
import {
	API_BASE,
	getCurrentModel,
	handleSelectClick,
	init,
	loadGLB,
	onRenderFrame,
	setRefPrismDims,
} from "./editor-main.js";
import { getEditorState, setCarSelection } from "./editor-state.js";
import { generateExport, validateMarkers } from "./export.js";
import { getMarkers, handleViewportClick } from "./marker-tool.js";
import { initObjectPanel, refreshObjectPanel } from "./object-panel.js";
import { getPhysicsOverrides } from "./physics-editor.js";
import type { PhysicsModal } from "./physics-modal.js";
import { getCurrentScale, initScaleControls, setScaleFromCar } from "./scale-controls.js";
import { initSketchfabPanel } from "./sketchfab-panel.js";
import { WheelAnimator } from "./wheel-animator.js";
import { initExportWiring } from "./wire-export.js";
import { initKeyboardWiring } from "./wire-keyboard.js";
import { initMarkerWiring } from "./wire-markers.js";
import { initObjectWiring } from "./wire-objects.js";
import { initSearchWiring } from "./wire-search.js";
import { initToolbarWiring } from "./wire-toolbar.js";

// ── DOM references ──
const viewport = document.getElementById("viewport");
const sidebar = document.getElementById("sidebar");
const startScreen = document.getElementById("start-screen");
const toolbar = document.querySelector("editor-toolbar");
const markerListEl = document.querySelector("marker-list");
const statusLine = document.querySelector("status-line");
const sidebarAttribution = document.getElementById("sidebar-attribution") as HTMLTextAreaElement | null;
const sidebarSubmitBtn = document.getElementById("btn-submit") as HTMLButtonElement | null;
const collapseAllBtn = document.getElementById("btn-collapse-all");

// ── loadCarForEditing (hoisted so start-screen events can reference it) ──
// Travel slider state (module-level so resetTravelSlider is accessible from loadModelAndReset)
let travelValue = 0;
let travelMaxCompress = 0.3;
let travelMaxExtend = 0.3;
let updateTravelUIFn: (() => void) | null = null;

function resetTravelSlider(): void {
	travelValue = 0;
	updateTravelUIFn?.();
	wheelAnimator.setSuspensionOffset(0);
}
const suspValue = document.getElementById("suspension-value");
const suspTrack = document.getElementById("susp-track") as HTMLElement | null;
const suspThumb = document.getElementById("susp-thumb") as HTMLElement | null;
const suspFillBottom = document.getElementById("susp-fill-bottom") as HTMLElement | null;
const suspFillTop = document.getElementById("susp-fill-top") as HTMLElement | null;
const suspRestSlider = document.getElementById("susp-rest") as HTMLInputElement | null;
const suspRestVal = document.getElementById("susp-rest-val");
const suspCompressSlider = document.getElementById("susp-compress") as HTMLInputElement | null;
const suspCompressVal = document.getElementById("susp-compress-val");
const suspStiffnessSlider = document.getElementById("susp-stiffness") as HTMLInputElement | null;
const suspStiffnessVal = document.getElementById("susp-stiffness-val");
const spinBtn = document.getElementById("btn-wheel-spin") as HTMLButtonElement | null;
const spinSpeedSlider = document.getElementById("spin-speed-slider") as HTMLInputElement | null;
const spinSpeedValue = document.getElementById("spin-speed-value");
let currentConfigId: number | null = null;

// ── Wheel Animator ──
const wheelAnimator = new WheelAnimator();
let _animatorFrameUnsub: (() => void) | null = null;

function initWheelAnimator(model: import("three").Group | null): void {
	// Unsubscribe previous frame callback
	if (_animatorFrameUnsub) {
		_animatorFrameUnsub();
		_animatorFrameUnsub = null;
	}
	if (model) {
		wheelAnimator.init(model);
		const cb = wheelAnimator.getFrameCallback();
		if (cb) _animatorFrameUnsub = onRenderFrame(cb);
	}
}

/** Get the wheel animator for other modules (e.g. toolbar). */
export function getWheelAnimator(): WheelAnimator {
	return wheelAnimator;
}

// ── Show/hide sidebar ──
function showSidebar(): void {
	sidebar?.classList.add("visible");
	// Update viewport position to account for sidebar
	const viewportEl = document.getElementById("viewport") as HTMLElement | null;
	if (viewportEl) {
		viewportEl.style.left = "280px";
		viewportEl.style.width = `calc(100% - 280px)`;
	}
	// Trigger Three.js renderer resize after layout settles
	import("./editor-main.js").then(({ triggerResize }) => {
		// Double-rAF to ensure the browser has reflowed after sidebar appears
		requestAnimationFrame(() => requestAnimationFrame(() => triggerResize()));
	});
}

function updateViewportPosition(): void {
	const viewportEl = document.getElementById("viewport") as HTMLElement | null;
	const sidebarEl = document.getElementById("sidebar") as HTMLElement | null;
	const toolbarEl = document.getElementById("toolbar") as HTMLElement | null;
	if (viewportEl && sidebarEl) {
		const sidebarWidth = sidebarEl.classList.contains("visible") ? sidebarEl.offsetWidth : 0;
		viewportEl.style.left = `${sidebarWidth}px`;
		viewportEl.style.width = sidebarWidth > 0 ? `calc(100% - ${sidebarWidth}px)` : "100%";
		if (toolbarEl) toolbarEl.style.left = `${sidebarWidth + 14}px`;
	}
}

// ── Init scene ──
if (!viewport) {
	console.error("Editor: required DOM elements missing");
} else {
	init(viewport);
}

/** Load a model, clear markers, and refresh the UI. */
export async function loadModelAndReset(path: string, name: string, attribution?: string): Promise<void> {
	currentConfigId = null; // reset — new model, not editing existing
	if (sidebarSubmitBtn) sidebarSubmitBtn.textContent = "Bake & Submit";
	// Reset wheel animator state
	wheelAnimator.setSpinning(false);
	if (spinBtn) {
		spinBtn.classList.remove("active");
		spinBtn.textContent = "Spin Wheels";
	}
	resetTravelSlider();
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

	// Initialize wheel animator
	initWheelAnimator(model);

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

// Sync face-select overlay transform every frame
import("./face-select.js").then(({ syncOverlay }) => {
	onRenderFrame(syncOverlay);
});
initSketchfabPanel((path, name, attribution) => {
	return loadModelAndReset(path, name, attribution);
});

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
	import("./face-select.js").then(({ onPointerDown: onFSPtrDown }) => onFSPtrDown(e));
});
viewport?.addEventListener("pointerup", (e) => {
	import("./face-select.js").then(({ onPointerUp }) => onPointerUp(e));
});
viewport?.addEventListener("pointermove", (e) => {
	import("./face-select.js").then(({ onPointerMove }) => onPointerMove(e));
});
viewport?.addEventListener("wheel", (e) => {
	import("./face-select.js").then(({ handleWheel }) => {
		handleWheel(e);
	});
}, { passive: false });
viewport?.addEventListener("click", (e) => {
	if (handleSelectClick(e)) return;
	// Check face-select mode
	import("./face-select.js").then(({ handleFaceSelectClick }) => {
		if (handleFaceSelectClick(e)) return;
		// Check assign mode first
		import("./assign-mode.js").then(({ handleAssignClick }) => {
			if (handleAssignClick(e)) return;
			handleViewportClick(e);
		});
	});
});
// Middle click for assign mode remove
viewport?.addEventListener("auxclick", (e) => {
	if (e.button === 1) {
		import("./assign-mode.js").then(({ handleAssignClick }) => handleAssignClick(e));
	}
});

// ── Collapse All ──
let _allCollapsed = false;
collapseAllBtn?.addEventListener("click", () => {
	_allCollapsed = !_allCollapsed;
	const panels = document.querySelectorAll("editor-panel");
	for (const p of panels) {
		(p as any).collapsed = _allCollapsed;
	}
	collapseAllBtn.classList.toggle("active", _allCollapsed);
});

// ── Load car for editing (module-scope so start-screen events can call it) ──
async function loadCarForEditing(configId: number, s3Key: string, carName: string): Promise<void> {
	if (!configId || !s3Key) return;

	try {
		const configResp = await fetch(`${API_BASE}/cars/imported/${configId}`);
		if (!configResp.ok) throw new Error(`HTTP ${configResp.status}`);
		const data = await configResp.json();

		currentConfigId = configId;

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
			const { placeMarker } = await import("./marker-tool.js");
			const { Vector3 } = await import("three");
			const { markers: markerNames } = data.schema;
			const wheelPos = data.config.wheelPositions as Array<{ x: number; y: number; z: number }>;
			if (wheelPos.length >= 4) {
				const cx = (wheelPos[0].x + wheelPos[1].x) / 2;
				const cy = wheelPos[0].y;
				const cz = (wheelPos[0].z + wheelPos[2].z) / 2;
				placeMarker("PhysicsMarker", new Vector3(cx, cy, cz));
			}
			const wheelNames = markerNames.wheels as string[];
			wheelNames.forEach((name: string, i: number) => {
				if (wheelPos[i]) placeMarker(name, new Vector3(wheelPos[i].x, wheelPos[i].y, wheelPos[i].z));
			});
			if (markerNames.escapePipes) {
				const ep = markerNames.escapePipes as { left?: string; right?: string };
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

		// Re-run auto-detect classification to restore mesh markings (userData.markedAs)
		// Loading a saved car only restores marker positions, not mesh markings.
		// We only need the classification part — markers are already restored above.
		const model = getCurrentModel();
		if (model) {
			try {
				const { autoDetect } = await import("./auto-detect.js");
				const { markObjectAs, highlightObject } = await import("./object-manager.js");
				// autoDetect places markers too, but placeMarker() handles duplicates (removes old first).
				// The positions should match what we already restored.
				const result = autoDetect(model);
				// Only re-mark meshes — skip marker placement (already done from saved data)
				const allItems = [
					...result.wheels,
					...result.brakeDiscs,
					...result.headlights,
					...result.taillights,
				];
				for (const item of allItems) {
					markObjectAs(model, item.mesh.uuid, item.type);
					highlightObject(model, item.mesh.uuid);
				}
				console.log(`[editor] Auto-restored mesh markings: ${allItems.length} items (${result.wheels.length} wheels, ${result.headlights.length} headlights, ${result.taillights.length} taillights, ${result.brakeDiscs.length} brake discs)`);
				const { refreshObjectPanel } = await import("./object-panel.js");
				refreshObjectPanel(model);
				const { ensureHighlightsVisible } = await import("./editor-main.js");
				ensureHighlightsVisible();
			} catch (err) {
				console.warn("[editor] Auto-detect restore failed:", err);
			}
		}

		// Initialize wheel animator after markers are placed
		initWheelAnimator(getCurrentModel());

		refreshUI();
	} catch (err) {
		console.error("[editor] Failed to load car for editing:", err);
		if (statusLine) statusLine.message = `Failed to load car #${configId}`;
	}
}

// ── Start Screen Events ──
startScreen?.addEventListener("start-edit", ((e: CustomEvent) => {
	const { configId, s3Key, name } = e.detail;
	// Show sidebar immediately, then load
	showSidebar();
	updateViewportPosition();
	loadCarForEditing(configId, s3Key, name);
}) as EventListener);

startScreen?.addEventListener("start-create", ((e: CustomEvent) => {
	const { carData, modelPath, modelName, attribution } = e.detail;
	showSidebar();
	updateViewportPosition();

	// Apply car data if provided
	if (carData) {
		setCarSelection({
			name: carData.name || modelName,
			dims: carData.dims,
		});

		// Update reference prism
		if (carData.dims) {
			setRefPrismDims(carData.dims.length_m, carData.dims.width_m, carData.dims.height_m);
		}

		// Push physics
		const carPhysics: Record<string, number> = {};
		if (carData.weightKg) carPhysics.mass = carData.weightKg;
		if (carData.weightFrontPct != null) carPhysics.weightFront = carData.weightFrontPct;
		if (Object.keys(carPhysics).length > 0) {
			import("./physics-editor.js").then(({ setPhysicsOverrides, setCarBaseline }) => {
				setPhysicsOverrides(carPhysics as any);
				setCarBaseline(carPhysics as any);
			});
		}
	}

	loadModelAndReset(modelPath, modelName, attribution);
}) as EventListener);

startScreen?.addEventListener("start-pending", ((e: CustomEvent) => {
	const { path, name, attribution } = e.detail;
	showSidebar();
	updateViewportPosition();
	loadModelAndReset(path, name, attribution);
}) as EventListener);

// ── Submit Button Validation Tooltip ──
let _validationTooltip: HTMLElement | null = null;
let _validationListenersAttached = false;

function updateSubmitButtonValidation(): void {
	if (!sidebarSubmitBtn) return;
	const markers = getMarkers();
	const issues = validateMarkers(markers);
	const errors = issues.filter((i) => i.type === "error");

	// Ensure tooltip DOM exists and listeners are wired exactly once
	if (!_validationTooltip && sidebarSubmitBtn) {
		const tooltip = document.createElement("div");
		tooltip.className = "submit-tooltip";
		const actionsDiv = sidebarSubmitBtn.closest(".export-actions") as HTMLElement | null;
		if (actionsDiv) {
			actionsDiv.style.position = "relative";
			actionsDiv.appendChild(tooltip);
		}
		_validationTooltip = tooltip;
	}
	if (!_validationListenersAttached && sidebarSubmitBtn && _validationTooltip) {
		sidebarSubmitBtn.addEventListener("mouseenter", () => {
			if (sidebarSubmitBtn?.disabled && sidebarSubmitBtn?.classList.contains("has-validation-issues")) {
				_validationTooltip?.classList.add("visible");
			}
		});
		sidebarSubmitBtn.addEventListener("mouseleave", () => {
			_validationTooltip?.classList.remove("visible");
		});
		_validationListenersAttached = true;
	}

	if (errors.length > 0) {
		sidebarSubmitBtn.disabled = true;
		sidebarSubmitBtn.classList.add("has-validation-issues");
		if (_validationTooltip) {
			_validationTooltip.innerHTML = `
				<div class="submit-tooltip-title">Fix before submitting</div>
				${errors.map((err) => `<div class="submit-tooltip-item error">• ${err.message}</div>`).join("")}
			`;
		}
	} else {
		// Only re-enable if not in a submit state
		const submitStates = ["baking", "uploading", "saving"];
		if (!submitStates.includes(sidebarSubmitBtn.dataset.state || "")) {
			sidebarSubmitBtn.disabled = false;
		}
		sidebarSubmitBtn.classList.remove("has-validation-issues");
		_validationTooltip?.classList.remove("visible");
	}
}

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
	sidebarSubmitBtn.dataset.state = state;
	sidebarSubmitBtn.disabled = state !== "idle" && state !== "success" && state !== "error";
	sidebarSubmitBtn.textContent = SUBMIT_LABELS[state];
	sidebarSubmitBtn.className = "btn-primary" + (state === "success" ? " success" : state === "error" ? " error" : "");
	const errorEl = document.getElementById("export-error");
	if (errorEl) {
		errorEl.textContent = state === "error" ? extra || "" : "";
		errorEl.className = "export-error" + (state === "error" && extra ? " visible" : "");
	}
	if (state === "error") setTimeout(() => setSubmitState("idle"), 4000);
}

sidebarSubmitBtn?.addEventListener("click", async () => {
	const model = getCurrentModel();
	if (!model) {
		setSubmitState("error", "No model loaded — use the start screen to pick or upload a model.");
		return;
	}

	const markers = getMarkers();
	const issues = validateMarkers(markers);
	const errors = issues.filter((i) => i.type === "error");
	if (errors.length > 0) {
		// Tooltip should already be visible on hover, but flash it briefly
		const tooltip = sidebarSubmitBtn?.closest(".export-actions")?.querySelector(".submit-tooltip");
		if (tooltip) {
			tooltip.classList.add("visible");
			setTimeout(() => tooltip.classList.remove("visible"), 2000);
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
	} catch (err) {
		setSubmitState("error", `Submit failed: ${err}`);
	}
});

// ── Initial state ──
refreshUI();

function refreshUI() {
	// Re-scan wheels for animator whenever markers change
	const model = getCurrentModel();
	if (model) initWheelAnimator(model);

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
	refreshObjectPanel(getCurrentModel());

	// Update submit button validation state
	updateSubmitButtonValidation();

	// ── Custom Travel Slider ──
	let travelDragging = false;

	function updateTravelUI(): void {
		if (!suspTrack || !suspThumb || !suspFillBottom || !suspFillTop || !suspValue) return;
		const totalRange = travelMaxCompress + travelMaxExtend;
		const ratio = totalRange > 0 ? travelMaxCompress / totalRange : 0.5;
		const thumbPct = ratio + (travelValue / totalRange) * 100;
		const clampedPct = Math.max(0, Math.min(100, thumbPct));
		suspThumb.style.left = `${clampedPct}%`;
		suspFillBottom.style.width = `${ratio * 100}%`;
		suspFillTop.style.width = `${(1 - ratio) * 100}%`;
		if (suspValue) suspValue.textContent = `${travelValue >= 0 ? "+" : ""}${travelValue.toFixed(2)}m`;
	}
	updateTravelUIFn = updateTravelUI;

	function setTravelFromPointer(clientX: number): void {
		if (!suspTrack) return;
		const rect = suspTrack.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const totalRange = travelMaxCompress + travelMaxExtend;
		const ratio = totalRange > 0 ? travelMaxCompress / totalRange : 0.5;
		travelValue = (pct - ratio) * totalRange;
		travelValue = Math.max(-travelMaxExtend, Math.min(travelMaxCompress, travelValue));
		updateTravelUI();
		wheelAnimator.setSuspensionOffset(travelValue);
	}

	if (suspTrack && suspThumb) {
		const physics = getPhysicsOverrides();
		travelMaxCompress = physics.maxSuspensionTravel ?? 0.3;
		travelMaxExtend = physics.suspensionRestLength ?? 0.3;
		updateTravelUI();

		suspThumb.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			travelDragging = true;
			suspThumb.setPointerCapture(e.pointerId);
		});
		suspTrack.addEventListener("pointerdown", (e) => {
			if (e.target === suspThumb) return;
			setTravelFromPointer(e.clientX);
			travelDragging = true;
			suspTrack.setPointerCapture(e.pointerId);
		});
		window.addEventListener("pointermove", (e) => {
			if (!travelDragging) return;
			setTravelFromPointer(e.clientX);
		});
		window.addEventListener("pointerup", () => {
			travelDragging = false;
		});
		suspTrack.addEventListener("dblclick", resetTravelSlider);

		// Update limits when physics change
		const physicsModal = document.querySelector("physics-modal");
		if (physicsModal) {
			physicsModal.addEventListener("physics-changed", () => {
				const p = getPhysicsOverrides();
				travelMaxCompress = p.maxSuspensionTravel ?? 0.3;
				travelMaxExtend = p.suspensionRestLength ?? 0.3;
				travelValue = Math.max(-travelMaxExtend, Math.min(travelMaxCompress, travelValue));
				updateTravelUI();
			});
		}
	}

	// ── Suspension param sliders (Rest, Compress, Stiffness) ──
	function wireSuspParam(
		slider: HTMLInputElement | null,
		valEl: HTMLElement | null,
		key: "suspensionRestLength" | "maxSuspensionTravel" | "suspensionStiffness",
		unit: string,
		decimals: number,
	): void {
		if (!slider || !valEl) return;
		const physics = getPhysicsOverrides();
		slider.value = `${physics[key] ?? slider.value}`;
		valEl.textContent = `${Number(slider.value).toFixed(decimals)}${unit}`;
		slider.addEventListener("input", async () => {
			const v = Number(slider.value);
			valEl.textContent = `${v.toFixed(decimals)}${unit}`;
			const { setPhysicsOverrides } = await import("./physics-editor.js");
			const cur = getPhysicsOverrides();
			setPhysicsOverrides({ ...cur, [key]: v });
			// Dispatch physics-changed so travel slider updates
			document.querySelector("physics-modal")?.dispatchEvent(new CustomEvent("physics-changed"));
		});
	}
	wireSuspParam(suspRestSlider, suspRestVal, "suspensionRestLength", "m", 2);
	wireSuspParam(suspCompressSlider, suspCompressVal, "maxSuspensionTravel", "m", 2);
	wireSuspParam(suspStiffnessSlider, suspStiffnessVal, "suspensionStiffness", "", 0);

	// ── Wheel Spin Test ──
	if (spinBtn) {
		spinBtn.addEventListener("click", () => {
			const spinning = !wheelAnimator.isSpinning();
			wheelAnimator.setSpinning(spinning);
			spinBtn.classList.toggle("active", spinning);
			spinBtn.textContent = spinning ? "Stop Spinning" : "Spin Wheels";
		});
	}
	if (spinSpeedSlider) {
		spinSpeedSlider.addEventListener("input", () => {
			const speed = parseFloat(spinSpeedSlider.value);
			wheelAnimator.setSpinSpeed(speed);
			if (spinSpeedValue) spinSpeedValue.textContent = `${speed.toFixed(0)} rad/s`;
		});
	}

	// ── Test in Practice ──
	const testPracticeBtn = document.getElementById("btn-test-practice");
	testPracticeBtn?.addEventListener("click", () => {
		if (currentConfigId) {
			window.open(`/practice?car=${currentConfigId}`, "_blank");
		} else {
			if (statusLine) statusLine.message = "Submit the car first, then test in practice.";
		}
	});
}
