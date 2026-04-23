/**
 * Marker placement system using raycasting and TransformControls.
 */
import * as THREE from "three";
import {
	getCamera,
	getCurrentModel,
	getMode,
	getModelCenter,
	getRenderer,
	getScene,
	getTransformControls,
} from "./editor-main.js";

export interface MarkerData {
	id: string;
	type: string;
	position: THREE.Vector3;
	mesh: THREE.Mesh;
	/** Whether this marker is locked to its symmetric pair (mirrors X movement). */
	locked: boolean;
	/** ID of the paired marker (null if unpaired). */
	pairId: string | null;
	/** Whether this marker is enabled (disabled markers excluded from export). */
	enabled: boolean;
}

const MARKER_COLORS: Record<string, number> = {
	Wheel_FL: 0x4aff8b,
	Wheel_FR: 0x8bff4a,
	Wheel_RL: 0x4aff8b,
	Wheel_RR: 0x8bff4a,
	Headlight_L: 0xffffff,
	Headlight_R: 0xffffff,
	Taillight_L: 0xff2222,
	Taillight_R: 0xff2222,
	Exhaust_L: 0xff8844,
	Exhaust_R: 0xff8844,
};

export const MARKER_TYPES = [
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

/** Symmetric pair mappings: type → mirror type */
const PAIR_MAP: Record<string, string> = {
	Wheel_FL: "Wheel_FR",
	Wheel_FR: "Wheel_FL",
	Wheel_RL: "Wheel_RR",
	Wheel_RR: "Wheel_RL",
	Exhaust_L: "Exhaust_R",
	Exhaust_R: "Exhaust_L",
	Headlight_L: "Headlight_R",
	Headlight_R: "Headlight_L",
	Taillight_L: "Taillight_R",
	Taillight_R: "Taillight_L",
};

/** Types that have symmetric pairs */
const PAIRED_TYPES = new Set(Object.keys(PAIR_MAP));

/** Exhaust_R is the only optional marker */
const OPTIONAL_TYPES = new Set(["Exhaust_R"]);

let markers: MarkerData[] = [];
let pendingType: string | null = null;
let activeMarkerId: string | null = null;
let onMarkersChangeCallback: ((markers: MarkerData[]) => void) | null = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export function getMarkers() {
	return markers;
}
export function setPendingType(type: string | null) {
	pendingType = type;
}
export function getPendingType() {
	return pendingType;
}

export function onMarkersChange(cb: (markers: MarkerData[]) => void) {
	onMarkersChangeCallback = cb;
}

function notifyChange() {
	onMarkersChangeCallback?.(markers);
}

export function isPairedType(type: string): boolean {
	return PAIRED_TYPES.has(type);
}

export function getMirrorType(type: string): string | null {
	return PAIR_MAP[type] ?? null;
}

export function isOptionalType(type: string): boolean {
	return OPTIONAL_TYPES.has(type);
}

/** Get the next unplaced marker type (skipping optional unless enabled). */
export function getNextUnplacedType(): string | null {
	const placed = new Set(markers.filter((m) => m.enabled).map((m) => m.type));
	for (const t of MARKER_TYPES) {
		if (!placed.has(t)) {
			// Skip optional types that are not explicitly enabled
			if (OPTIONAL_TYPES.has(t)) continue;
			return t;
		}
	}
	// All non-optional placed — check optional
	for (const t of MARKER_TYPES) {
		if (!placed.has(t)) return t;
	}
	return null;
}

function createMarkerMesh(type: string): THREE.Mesh {
	const color = MARKER_COLORS[type] ?? 0xff00ff;
	const geo = new THREE.SphereGeometry(0.05, 16, 16);
	const mat = new THREE.MeshStandardMaterial({
		color,
		emissive: color,
		emissiveIntensity: 0.5,
		depthTest: false,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = 999;
	mesh.userData.isMarker = true;
	return mesh;
}

export function placeMarker(
	type: string,
	position: THREE.Vector3,
	options?: { enabled?: boolean; skipPair?: boolean },
): MarkerData {
	ensureTransformListener();
	// Remove existing marker of same type
	const existing = markers.findIndex((m) => m.type === type);
	if (existing >= 0) {
		getScene().remove(markers[existing].mesh);
		markers.splice(existing, 1);
	}

	const mesh = createMarkerMesh(type);
	mesh.position.copy(position);
	getScene().add(mesh);

	const data: MarkerData = {
		id: `${type}_${Date.now()}`,
		type,
		position: position.clone(),
		mesh,
		locked: true,
		pairId: null,
		enabled: options?.enabled ?? true,
	};
	markers.push(data);

	// Wire up pair if applicable
	const mirrorType = PAIR_MAP[type];
	if (mirrorType && !options?.skipPair) {
		const existingPair = markers.find((m) => m.type === mirrorType);
		if (existingPair) {
			data.pairId = existingPair.id;
			existingPair.pairId = data.id;
			data.locked = true;
			existingPair.locked = true;
		} else if (!OPTIONAL_TYPES.has(mirrorType)) {
			// Auto-create mirror for non-optional pairs
			const center = getModelCenter();
			const mirrorPos = position.clone();
			mirrorPos.x = center.x - (position.x - center.x);
			const mirrorData = placeMarker(mirrorType, mirrorPos, { skipPair: true });
			data.pairId = mirrorData.id;
			mirrorData.pairId = data.id;
			data.locked = true;
			mirrorData.locked = true;
		}
	}

	notifyChange();
	return data;
}

/** Place a marker pair from the "+" button. Returns the primary marker. */
export function placeMarkerPair(type: string): MarkerData {
	return placeMarker(type, new THREE.Vector3(), { enabled: true });
}

export function removeMarker(id: string) {
	const idx = markers.findIndex((m) => m.id === id);
	if (idx >= 0) {
		const marker = markers[idx];
		// Unlink pair
		if (marker.pairId) {
			const pair = markers.find((m) => m.id === marker.pairId);
			if (pair) {
				pair.pairId = null;
				pair.locked = false;
			}
		}
		getScene().remove(marker.mesh);
		if (activeMarkerId === id) {
			getTransformControls().detach();
			activeMarkerId = null;
		}
		markers.splice(idx, 1);
		notifyChange();
	}
}

export function removeMarkerByType(type: string) {
	const m = markers.find((m) => m.type === type);
	if (m) removeMarker(m.id);
}

export function selectMarker(id: string) {
	const marker = markers.find((m) => m.id === id);
	if (!marker) return;
	activeMarkerId = id;
	getTransformControls().attach(marker.mesh);
}

export function clearMarkers() {
	for (const m of markers) getScene().remove(m.mesh);
	markers = [];
	activeMarkerId = null;
	getTransformControls().detach();
	notifyChange();
}

/** Toggle lock state for a marker (and its pair). */
export function toggleMarkerLock(id: string): boolean {
	const marker = markers.find((m) => m.id === id);
	if (!marker || !marker.pairId) return false;
	const pair = markers.find((m) => m.id === marker.pairId);
	if (!pair) return false;
	const newState = !marker.locked;
	marker.locked = newState;
	pair.locked = newState;
	notifyChange();
	return newState;
}

/** Toggle enabled state for an optional marker. */
export function toggleMarkerEnabled(id: string): boolean {
	const marker = markers.find((m) => m.id === id);
	if (!marker) return false;
	marker.enabled = !marker.enabled;
	// Update mesh visibility
	marker.mesh.visible = marker.enabled;
	notifyChange();
	return marker.enabled;
}

// Track marker position changes from TransformControls
let draggingMarker: string | null = null;
let transformListenerAdded = false;

function ensureTransformListener() {
	if (transformListenerAdded) return;
	const tc = getTransformControls();
	if (!tc) return;
	tc.addEventListener("dragging-changed", (e) => {
		if (!e.value && draggingMarker) {
			const m = markers.find((m) => m.id === draggingMarker);
			if (m) {
				m.position.copy(m.mesh.position);
				// Mirror to pair if locked
				if (m.locked && m.pairId) {
					const pair = markers.find((p) => p.id === m.pairId);
					if (pair) {
						const center = getModelCenter();
						pair.mesh.position.x = center.x - (m.position.x - center.x);
						pair.mesh.position.y = m.position.y;
						pair.mesh.position.z = m.position.z;
						pair.position.copy(pair.mesh.position);
					}
				}
			}
			draggingMarker = null;
			notifyChange();
		}
		if (e.value) {
			// Find which marker is attached
			const obj = tc.object as THREE.Mesh;
			const m = markers.find((m) => m.mesh === obj);
			if (m) draggingMarker = m.id;
		}
	});
	transformListenerAdded = true;
}

/**
 * Handle click on viewport for place/delete modes.
 */
export function handleViewportClick(event: MouseEvent) {
	const mode = getMode();
	const model = getCurrentModel();
	if (!model) return;

	const rect = getRenderer().domElement.getBoundingClientRect();
	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	raycaster.setFromCamera(mouse, getCamera());

	if (mode === "place" && pendingType) {
		const intersects = raycaster.intersectObject(model, true);
		if (intersects.length > 0) {
			placeMarker(pendingType, intersects[0].point);
			// Don't auto-advance — clear pending type
			pendingType = null;
		}
	} else if (mode === "delete") {
		// Check if clicking on a marker
		const markerMeshes = markers.map((m) => m.mesh);
		const intersects = raycaster.intersectObjects(markerMeshes);
		if (intersects.length > 0) {
			const hitMesh = intersects[0].object as THREE.Mesh;
			const m = markers.find((m) => m.mesh === hitMesh);
			if (m) removeMarker(m.id);
		}
	}
}

export function getMarkerTypes() {
	return MARKER_TYPES;
}
