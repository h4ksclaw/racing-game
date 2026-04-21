/**
 * Import car flow — step wizard, physics panel init, suspension viz, bake & submit.
 */

import { bakeModel } from "./bake-export.js";
import { API_BASE, getCurrentModel } from "./editor-main.js";
import { generateExport, validateMarkers } from "./export.js";
import { getMarkers } from "./marker-tool.js";
import { createPhysicsPanel, getPhysicsOverrides, onOverridesChange } from "./physics-editor.js";
import { hideSuspensionRange, showSuspensionRange } from "./suspension-viz.js";

const importSection = document.getElementById("import-section");
const importSteps = document.querySelectorAll(".import-step");
let importStep = 0;

export interface ImportState {
	carName: string;
	modelPath: string;
	modelScale: number;
	sketchfabAttribution: string;
	carMetadataId: number | null;
}

export function initImportFlow(state: ImportState): void {
	if (!importSection) return;

	const nextBtn = document.getElementById("import-next-btn");
	const prevBtn = document.getElementById("import-prev-btn");
	const bakeBtn = document.getElementById("import-bake-btn") as HTMLButtonElement | null;

	if (nextBtn) nextBtn.addEventListener("click", () => setImportStep(importStep + 1));
	if (prevBtn) prevBtn.addEventListener("click", () => setImportStep(Math.max(0, importStep - 1)));

	// Physics panel
	const physicsContainer = document.getElementById("physics-panel-container");
	if (physicsContainer) createPhysicsPanel(physicsContainer);

	// Suspension viz toggle
	const suspToggle = document.getElementById("susp-viz-toggle") as HTMLInputElement | null;
	if (suspToggle) {
		suspToggle.addEventListener("change", () => {
			if (suspToggle.checked) {
				const model = getCurrentModel();
				if (model) showSuspensionRange(model, getMarkers(), getPhysicsOverrides());
			} else {
				hideSuspensionRange();
			}
		});
	}

	onOverridesChange((overrides) => {
		const t = document.getElementById("susp-viz-toggle") as HTMLInputElement | null;
		if (t?.checked) {
			const model = getCurrentModel();
			if (model) showSuspensionRange(model, getMarkers(), overrides);
		}
	});

	// Bake & Submit
	if (bakeBtn) {
		bakeBtn.addEventListener("click", async () => {
			const model = getCurrentModel();
			if (!model) {
				alert("No model loaded");
				return;
			}
			const markers = getMarkers();
			const issues = validateMarkers(markers);
			if (issues.some((i) => i.type === "error")) {
				alert(
					"Fix errors: " +
						issues
							.filter((i) => i.type === "error")
							.map((i) => i.message)
							.join(", "),
				);
				return;
			}

			bakeBtn.disabled = true;
			bakeBtn.textContent = "Baking...";
			try {
				const bakeResult = await bakeModel(model, markers, { includeMarkers: true, applyObjectMarks: true });
				bakeBtn.textContent = "Uploading to S3...";

				const formData = new FormData();
				formData.append(
					"model",
					new Blob([bakeResult.glbBuffer], { type: "model/gltf-binary" }),
					`${state.carName || "car"}.glb`,
				);
				const s3Resp = await fetch(`${API_BASE}/s3/upload`, { method: "POST", body: formData });
				if (!s3Resp.ok) throw new Error(`S3 upload failed: ${s3Resp.status}`);
				const { key: s3Key } = await s3Resp.json();

				bakeBtn.textContent = "Saving config...";
				const physics = getPhysicsOverrides();
				const exportPayload = generateExport(state.carName || "unnamed", `s3:${s3Key}`, state.modelScale, markers);
				const attribution =
					(document.getElementById("import-attribution") as HTMLTextAreaElement)?.value ||
					state.sketchfabAttribution ||
					"";

				const importResp = await fetch(`${API_BASE}/cars/import`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						config: exportPayload.chassis,
						modelSchema: exportPayload.schema,
						physicsOverrides: physics,
						attribution,
						s3Key,
						carMetadataId: state.carMetadataId ?? undefined,
					}),
				});

				if (!importResp.ok) throw new Error(`Import failed: ${importResp.status}`);
				const result = await importResp.json();
				bakeBtn.textContent = `✓ Imported (ID: ${result.configId})`;
				setTimeout(() => {
					bakeBtn.textContent = "Bake & Submit";
					bakeBtn.disabled = false;
				}, 3000);
			} catch (err) {
				bakeBtn.textContent = "✕ Error";
				alert(`Import failed: ${err}`);
				setTimeout(() => {
					bakeBtn.textContent = "Bake & Submit";
					bakeBtn.disabled = false;
				}, 3000);
			}
		});
	}
}

function setImportStep(step: number) {
	importStep = step;
	importSteps.forEach((el, i) => {
		el.classList.toggle("active", i <= step);
		el.classList.toggle("done", i < step);
	});
	document.querySelectorAll(".import-panel").forEach((el, i) => {
		(el as HTMLElement).style.display = i === step ? "block" : "none";
	});
}
