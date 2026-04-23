/**
 * Toolbar wiring — connects editor-toolbar Lit component events to editor modules.
 */
import { Box3, Vector3 } from "three";
import { getCamera, getCurrentModel, getOrbitControls, setMode } from "./editor-main.js";
import { getMarkers, selectMarker, setPendingType } from "./marker-tool.js";

export function initToolbarWiring(
	toolbar: HTMLElement & {
		mode?: string;
		assignType?: string;
		pendingPlaceType?: string;
		wireframe?: boolean;
		dimensions?: boolean;
		highlights?: boolean;
	},
): void {
	toolbar.addEventListener("mode-change", (e: Event) => {
		const mode = (e as CustomEvent<string>).detail;
		if (mode !== "place") {
			setPendingType(null);
			toolbar.pendingPlaceType = "";
		}
		// Exit assign mode when switching to other modes
		if (mode !== "assign") {
			import("./assign-mode.js").then(({ exitAssignMode }) => exitAssignMode());
		}
		setMode(mode as "orbit" | "select" | "place" | "move" | "delete" | "assign");
		toolbar.mode = mode;
		toolbar.assignType = "";
		if (mode === "move") {
			const markers = getMarkers();
			if (markers.length > 0) {
				const markerList = document.querySelector("marker-list") as any;
				const selectedId = markerList?.selectedId;
				const target = selectedId ? markers.find((m) => m.id === selectedId) : markers[0];
				if (target) selectMarker(target.id);
			}
		}
	});

	toolbar.addEventListener("toggle", (e: Event) => {
		const toggle = (e as CustomEvent<string>).detail;
		if (toggle === "wireframe") {
			toolbar.wireframe = !toolbar.wireframe;
			import("./editor-main.js").then(({ toggleWireframe }) => toggleWireframe());
		} else if (toggle === "dimensions") {
			toolbar.dimensions = !toolbar.dimensions;
			import("./editor-main.js").then(({ toggleDims }) => toggleDims());
			import("./dimension-overlay.js").then(({ updateDimensions: ud }) => ud());
		} else if (toggle === "highlights") {
			import("./editor-main.js").then(({ toggleHighlights }) => {
				const visible = toggleHighlights();
				toolbar.highlights = visible;
			});
		}
	});

	toolbar.addEventListener("auto-detect", () => {
		const model = getCurrentModel();
		if (!model) return;
		import("./auto-detect.js").then(({ autoDetect }) => {
			import("./marker-tool.js").then(({ placeMarker }) => {
				import("./object-manager.js").then(({ markObjectAs, highlightObject }) => {
					const result = autoDetect(model);

					// Place markers (wheels + exhausts + physics)
					const markerTypes: { type: string; pos: Vector3 }[] = [
						...result.wheels.map((w) => ({
							type: w.type.replace("wheel_", "Wheel_") as string,
							pos: w.position,
						})),
						...result.exhaustMarkers.map((e) => ({
							type: e.type.replace("exhaust_", "Exhaust_") as string,
							pos: e.position,
						})),
					];
					if (result.physicsMarker) {
						markerTypes.push({
							type: "PhysicsMarker",
							pos: result.physicsMarker,
						});
					}
					for (const m of markerTypes) placeMarker(m.type, m.pos);

					// Assign highlights to detected objects (NOT exhausts — those are marker-only)
					const allItems = [...result.wheels, ...result.brakeDiscs, ...result.headlights, ...result.taillights];
					for (const item of allItems) {
						const markType = item.type;
						markObjectAs(model, item.mesh.uuid, markType);
						highlightObject(model, item.mesh.uuid);
					}

					// Refresh object panel to show new badges
					import("./object-panel.js").then(({ refreshObjectPanel }) => refreshObjectPanel(model));

					// Sync highlight toggle state (manual highlights bypass the toggle flag)
					import("./editor-main.js").then(({ ensureHighlightsVisible }) => ensureHighlightsVisible());

					// Show warnings if any
					if (result.warnings.length > 0) {
						const msg = result.warnings.join("\n");
						console.warn(`[auto-detect] Warnings:\n${msg}`);
						// Dispatch warning event for UI
						document.dispatchEvent(
							new CustomEvent("toast", {
								detail: {
									message: `Auto-detect warnings: ${result.warnings.length} position mismatches`,
									type: "warning",
								},
								bubbles: true,
							}),
						);
					}

					if (result.flipped) {
						document.dispatchEvent(
							new CustomEvent("toast", {
								detail: {
									message: "Car was auto-rotated 180° — name positions now match",
									type: "info",
								},
								bubbles: true,
							}),
						);
					}

					// Summary toast
					const total = allItems.length + result.exhaustMarkers.length;
					if (total > 0) {
						document.dispatchEvent(
							new CustomEvent("toast", {
								detail: {
									message: `Detected ${result.wheels.length} wheels, ${result.brakeDiscs.length} brake discs, ${result.headlights.length} headlights, ${result.taillights.length} taillights, ${result.exhaustMarkers.length} exhaust markers`,
									type: "success",
								},
								bubbles: true,
							}),
						);
					} else {
						document.dispatchEvent(
							new CustomEvent("toast", {
								detail: {
									message: "No components detected — try naming your meshes (wheel_FL, brake_disc_RR, etc.)",
									type: "warning",
								},
								bubbles: true,
							}),
						);
					}
				});
			});
		});
	});

	toolbar.addEventListener("explode", (e: Event) => {
		import("./editor-main.js").then(({ setExploded }) => setExploded((e as CustomEvent<boolean>).detail));
	});

	toolbar.addEventListener("assign-open", (e: Event) => {
		import("./assign-mode.js").then(({ openAssignDropdown }) => {
			const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
			openAssignDropdown(x, y);
		});
	});

	// Assign mode activates when user picks a type from dropdown
	document.addEventListener("assign-active", (e: Event) => {
		const type = (e as CustomEvent<string>).detail;
		toolbar.mode = "assign";
		toolbar.assignType = type;
	});

	// Assign mode deactivates
	document.addEventListener("assign-exit", () => {
		if (toolbar.mode === "assign") {
			toolbar.mode = "select";
			toolbar.assignType = "";
		}
	});

	toolbar.addEventListener("download-glb", () => {
		const model = getCurrentModel();
		if (!model) return;
		import("three/addons/exporters/GLTFExporter.js").then(({ GLTFExporter }) => {
			const exporter = new GLTFExporter();
			exporter.parse(
				model,
				(result) => {
					const blob = new Blob([result as ArrayBuffer], {
						type: "application/octet-stream",
					});
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = "model.glb";
					a.click();
					URL.revokeObjectURL(url);
				},
				(error) => {
					console.error("[editor] GLB export failed:", error);
				},
				{ binary: true },
			);
		});
	});

	toolbar.addEventListener("view-change", (e: Event) => {
		const model = getCurrentModel();
		if (!model) return;
		const view = (e as CustomEvent<string>).detail;
		import("./view-controls.js").then(({ setViewPreset, fitCameraToModel }) => {
			if (view === "fit") {
				fitCameraToModel(getCamera(), getOrbitControls(), model);
			} else {
				const box = new Box3().setFromObject(model);
				const center = box.getCenter(new Vector3());
				setViewPreset(view as "front" | "back" | "top" | "left" | "right", getCamera(), getOrbitControls(), center);
			}
		});
	});
}
