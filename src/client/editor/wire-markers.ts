/**
 * Marker list wiring — connects marker-list Lit component events to marker-tool module.
 */

import { setMode } from "./editor-main.js";
import {
	getNextUnplacedType,
	onMarkersChange,
	placeMarkerPair,
	removeMarker,
	selectMarker,
	setPendingType,
	toggleMarkerEnabled,
	toggleMarkerLock,
} from "./marker-tool.js";

export function initMarkerWiring(
	markerListEl: HTMLElement & { mode?: string },
	toolbar: HTMLElement & { mode?: string },
	refreshUI: () => void,
): void {
	markerListEl.addEventListener("marker-replace", (e: Event) => {
		const { type } = (e as CustomEvent<{ id: string; type: string }>).detail;
		setPendingType(type);
		setMode("place");
		toolbar.mode = "place";
		(toolbar as any).pendingPlaceType = type.replace(/_/g, " ");
	});

	markerListEl.addEventListener("marker-delete", (e: Event) => {
		removeMarker((e as CustomEvent<string>).detail);
	});

	markerListEl.addEventListener("marker-select", (e: Event) => {
		selectMarker((e as CustomEvent<string>).detail);
	});

	markerListEl.addEventListener("marker-move", (e: Event) => {
		selectMarker((e as CustomEvent<string>).detail);
		setMode("move");
		setPendingType(null);
		toolbar.mode = "move";
	});

	markerListEl.addEventListener("marker-lock", (e: Event) => {
		toggleMarkerLock((e as CustomEvent<string>).detail);
	});

	markerListEl.addEventListener("marker-enable", (e: Event) => {
		toggleMarkerEnabled((e as CustomEvent<string>).detail);
	});

	markerListEl.addEventListener("marker-add", () => {
		const nextType = getNextUnplacedType();
		if (!nextType) return;
		placeMarkerPair(nextType);
		setPendingType(null);
	});

	onMarkersChange(() => refreshUI());
}
