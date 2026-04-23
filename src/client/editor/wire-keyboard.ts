/**
 * Keyboard shortcut wiring — Unreal/Unity-style left-hand shortcuts.
 * Skips when user is typing in any input field (including shadow DOM).
 */
import { frameModel, getMode, getSelectedObjectUUID, setMode } from "./editor-main.js";
import {
	getMarkers,
	getNextUnplacedType,
	removeMarker,
	setPendingType as setMarkerPendingType,
} from "./marker-tool.js";

/** Check if the event target is inside a text-inputting element (including shadow DOM). */
function isTyping(e: KeyboardEvent): boolean {
	const el = e.target as HTMLElement | null;
	if (!el) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	// Check for input inside shadow DOM — walk up to find any host that contains an input
	// or check the composed path for input/textarea
	const path = e.composedPath();
	for (const node of path) {
		const n = node as HTMLElement;
		if (n.nodeType === 1) {
			const t = n.tagName;
			if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
			// Also skip when inside known Lit panel components
			if (t === "CAR-SEARCH-PANEL" || t === "SKETCHFAB-PANEL") return true;
		}
	}
	return false;
}

export function initKeyboardWiring(toolbar: HTMLElement & { mode?: string; highlights?: boolean }): void {
	document.addEventListener("keydown", (e: KeyboardEvent) => {
		if (isTyping(e)) return;

		switch (e.key.toLowerCase()) {
			case "w":
				toolbar.dispatchEvent(
					new CustomEvent("mode-change", {
						detail: "move",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "e":
				toolbar.dispatchEvent(
					new CustomEvent("explode", {
						detail: true,
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "q":
				toolbar.dispatchEvent(
					new CustomEvent("mode-change", {
						detail: e.shiftKey ? "select" : "orbit",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "r": {
				const markerList = document.querySelector("marker-list") as any;
				const selectedId = markerList?.selectedId;
				let placeType = "";
				if (selectedId) {
					const marker = getMarkers().find((m) => m.id === selectedId);
					if (marker) {
						setMarkerPendingType(marker.type);
						placeType = marker.type;
					}
				}
				if (!placeType) {
					const nextType = getNextUnplacedType();
					if (nextType) {
						setMarkerPendingType(nextType);
						placeType = nextType;
					}
				}
				toolbar.dispatchEvent(
					new CustomEvent("mode-change", {
						detail: "place",
						bubbles: true,
						composed: true,
					}),
				);
				(toolbar as any).pendingPlaceType = placeType.replace(/_/g, " ");
				break;
			}
			case "f":
				frameModel();
				break;
			case "delete":
			case "backspace": {
				const markerList = document.querySelector("marker-list") as any;
				if (markerList?.selectedId) {
					removeMarker(markerList.selectedId);
					break;
				}
				if (getMode() === "move" || getMode() === "select") {
					const uuid = getSelectedObjectUUID();
					if (uuid) {
						const marker = getMarkers().find((m) => m.id === uuid || m.mesh.uuid === uuid);
						if (marker) removeMarker(marker.id);
					}
				}
				break;
			}
			case "x":
				import("./editor-main.js").then(({ toggleWireframe }) => toggleWireframe());
				break;
			case "z":
				import("./editor-main.js").then(({ toggleDims }) => toggleDims());
				import("./dimension-overlay.js").then(({ updateDimensions: ud }) => ud());
				break;
			case "a": {
				if (e.shiftKey) {
					toolbar.dispatchEvent(new CustomEvent("auto-detect", { bubbles: true, composed: true }));
				} else {
					import("./assign-mode.js").then(({ getLastMousePos }) => {
						const { x, y } = getLastMousePos();
						toolbar.dispatchEvent(
							new CustomEvent("assign-open", {
								detail: { x, y },
								bubbles: true,
								composed: true,
							}),
						);
					});
				}
				break;
			}
			case "h":
				import("./editor-main.js").then(({ toggleHighlights }) => {
					const visible = toggleHighlights();
					toolbar.highlights = visible;
				});
				break;
			case "escape":
				setMode("select");
				setMarkerPendingType(null);
				toolbar.mode = "select";
				import("./assign-mode.js").then(({ exitAssignMode }) => exitAssignMode());
				break;
			case "1":
				toolbar.dispatchEvent(
					new CustomEvent("view-change", {
						detail: "front",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "2":
				toolbar.dispatchEvent(
					new CustomEvent("view-change", {
						detail: "back",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "3":
				toolbar.dispatchEvent(
					new CustomEvent("view-change", {
						detail: "top",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "4":
				toolbar.dispatchEvent(
					new CustomEvent("view-change", {
						detail: "left",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "5":
				toolbar.dispatchEvent(
					new CustomEvent("view-change", {
						detail: "right",
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "0":
				frameModel();
				break;
		}
	});
}
