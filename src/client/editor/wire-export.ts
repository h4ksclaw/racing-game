/**
 * Export button wiring — connects physics/export/download buttons to their modules.
 */

import { getCurrentModel } from "./editor-main.js";
import { getEditorState } from "./editor-state.js";
import { downloadJSON, generateExport } from "./export.js";
import { getMarkers } from "./marker-tool.js";
import { getPhysicsOverrides } from "./physics-editor.js";
import type { PhysicsModal } from "./physics-modal.js";
import { getCurrentScale } from "./scale-controls.js";
import { updatePreview } from "./suspension-viz.js";

export function initExportWiring(): void {
	document.getElementById("btn-physics")?.addEventListener("click", () => {
		const modal = document.querySelector("physics-modal") as PhysicsModal | null;
		modal?.openModal();
	});

	document.getElementById("btn-download")?.addEventListener("click", () => {
		const state = getEditorState();
		const payload = generateExport(state.car.name || "unnamed", state.car.modelPath, getCurrentScale().x, getMarkers());
		downloadJSON(payload);
	});

	// Suspension preview callback
	import("./physics-editor.js").then(({ onSuspPreviewChange }) => {
		onSuspPreviewChange(() => {
			const model = getCurrentModel();
			if (model) updatePreview(getMarkers(), getPhysicsOverrides());
		});
	});
}
