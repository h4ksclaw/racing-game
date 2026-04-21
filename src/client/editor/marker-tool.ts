/**
 * Marker placement system using raycasting and TransformControls.
 */
import * as THREE from "three";
import { getCamera, getCurrentModel, getMode, getRenderer, getScene, getTransformControls } from "./editor-main.js";

export interface MarkerData {
	id: string;
	type: string;
	position: THREE.Vector3;
	mesh: THREE.Mesh;
}

const MARKER_COLORS: Record<string, number> = {
	PhysicsMarker: 0x4a9eff,
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

const MARKER_TYPES = [
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

export function placeMarker(type: string, position: THREE.Vector3): MarkerData {
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
	};
	markers.push(data);
	notifyChange();
	return data;
}

export function removeMarker(id: string) {
	const idx = markers.findIndex((m) => m.id === id);
	if (idx >= 0) {
		getScene().remove(markers[idx].mesh);
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

// Track marker position changes from TransformControls
let draggingMarker: string | null = null;
getTransformControls().addEventListener("dragging-changed", (e) => {
	if (!e.value && draggingMarker) {
		const m = markers.find((m) => m.id === draggingMarker);
		if (m) m.position.copy(m.mesh.position);
		draggingMarker = null;
		notifyChange();
	}
	if (e.value) {
		// Find which marker is attached
		const obj = getTransformControls().object as THREE.Mesh;
		const m = markers.find((m) => m.mesh === obj);
		if (m) draggingMarker = m.id;
	}
});

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
