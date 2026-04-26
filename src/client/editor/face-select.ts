/**
 * Face-level selection tool — Blender-style circle select.
 *
 * Usage: Enter face-select mode (F key), click a mesh to activate it,
 * then click+drag to paint faces, Ctrl+drag to erase, scroll to resize brush.
 * A visible circle cursor shows the brush size. Press Enter to create a virtual group.
 */
import * as THREE from "three";
import { getCamera, getCurrentModel, getMode, getRenderer, setMode } from "./editor-main.js";
import { FaceOverlayManager } from "./face-overlay.js";
import { refreshObjectPanel } from "./object-panel.js";

// ── Data structures ──

export interface VirtualGroup {
	name: string;
	markedAs: string | null;
	faces: number[];
	color?: string;
}

// ── State ──

let activeMesh: THREE.Mesh | null = null;
let selectedFaceIndices = new Set<number>();
let painting = false;
let erasing = false;
let brushRadius = 0.08; // fraction of screen height — adjustable via scroll
let lastMousePos: { x: number; y: number } = { x: 0, y: 0 };
let pointerDownPos: { x: number; y: number } | null = null;
const overlayManager = new FaceOverlayManager();
let dialogEl: HTMLDivElement | null = null;
let brushCursorEl: HTMLDivElement | null = null;

const MARK_AS_OPTIONS = [
	{ label: "Taillight", value: "taillight" },
	{ label: "Headlight", value: "headlight" },
	{ label: "Bloom", value: "bloom" },
	{ label: "Brake Disc", value: "brake_disc" },
	{ label: "Collision", value: "collision" },
];

// ── Accessors ──

export function getActiveMesh(): THREE.Mesh | null {
	return activeMesh;
}

export function getSelectedFaces(): Set<number> {
	return selectedFaceIndices;
}

export function getBrushRadius(): number {
	return brushRadius;
}

export function setBrushRadius(r: number): void {
	brushRadius = Math.max(0.005, Math.min(0.5, r));
	updateBrushCursorSize();
}

export function getLastMousePos(): { x: number; y: number } {
	return lastMousePos;
}

// ── Brush cursor ──

function createBrushCursor(): void {
	if (brushCursorEl) return;
	brushCursorEl = document.createElement("div");
	brushCursorEl.id = "face-select-brush-cursor";
	Object.assign(brushCursorEl.style, {
		position: "fixed",
		pointerEvents: "none",
		zIndex: "10000",
		border: "2px solid rgba(0,255,136,0.8)",
		borderRadius: "50%",
		transform: "translate(-50%,-50%)",
		transition: "width 0.1s, height 0.1s",
		mixBlendMode: "difference",
		display: "none",
	});
	document.body.appendChild(brushCursorEl);
}

function removeBrushCursor(): void {
	brushCursorEl?.remove();
	brushCursorEl = null;
}

function updateBrushCursorPosition(x: number, y: number, shiftHeld: boolean): void {
	if (!brushCursorEl) return;
	brushCursorEl.style.left = `${x}px`;
	brushCursorEl.style.top = `${y}px`;
	brushCursorEl.style.display = shiftHeld ? "block" : "none";
}

function updateBrushCursorSize(): void {
	if (!brushCursorEl) return;
	// Convert world brush radius to screen pixels
	const renderer = getRenderer();
	if (!renderer) return;
	const camera = getCamera();
	if (!camera || !(camera instanceof THREE.PerspectiveCamera)) return;

	// Project a world-space distance at the active mesh's center to screen pixels
	let worldDist = brushRadius * 2; // diameter
	if (activeMesh) {
		// Get distance from camera to mesh center
		const meshCenter = new THREE.Vector3();
		new THREE.Box3().setFromObject(activeMesh).getCenter(meshCenter);
		const camDist = camera.position.distanceTo(meshCenter);
		// Convert world radius to screen pixels: tan(fov/2) * distance = half-height in world
		const fovRad = THREE.MathUtils.degToRad(camera.fov);
		const screenHeightWorld = 2 * Math.tan(fovRad / 2) * camDist;
		const rect = renderer.domElement.getBoundingClientRect();
		const screenHeightPx = rect.height;
		worldDist = (brushRadius * 2 / screenHeightWorld) * screenHeightPx;
	} else {
		// Fallback: rough estimate
		worldDist = brushRadius * 2000;
	}

	worldDist = Math.max(10, Math.min(400, worldDist));
	brushCursorEl.style.width = `${worldDist}px`;
	brushCursorEl.style.height = `${worldDist}px`;
}

// ── Mode enter/exit ──

export function enterFaceSelectMode(): void {
	activeMesh = null;
	selectedFaceIndices.clear();
	overlayManager.clear();
	closeGroupDialog();
	createBrushCursor();
	// Track Shift key for painting vs orbit
	window.addEventListener("keydown", onShiftKeyDown);
	window.addEventListener("keyup", onShiftKeyUp);
	setMode("face-select");
}

export function exitFaceSelectMode(): void {
	activeMesh = null;
	selectedFaceIndices.clear();
	overlayManager.clear();
	closeGroupDialog();
	removeBrushCursor();
	window.removeEventListener("keydown", onShiftKeyDown);
	window.removeEventListener("keyup", onShiftKeyUp);
	if (getMode() === "face-select") setMode("select");
}

// ── Pointer tracking ──

let shiftHeld = false;

function onShiftKeyDown(e: KeyboardEvent): void {
	if (e.key === "Shift" && !shiftHeld) {
		shiftHeld = true;
		updateBrushCursorPosition(lastMousePos.x, lastMousePos.y, true);
	}
}

function onShiftKeyUp(e: KeyboardEvent): void {
	if (e.key === "Shift") {
		shiftHeld = false;
		updateBrushCursorPosition(lastMousePos.x, lastMousePos.y, false);
		if (painting || erasing) {
			painting = false;
			erasing = false;
			import("./editor-main.js").then(({ getOrbitControls }) => {
				getOrbitControls().enabled = true;
			});
		}
	}
}

export function onPointerDown(e: PointerEvent): void {
	if (getMode() !== "face-select") return;
	lastMousePos = { x: e.clientX, y: e.clientY };
	pointerDownPos = { x: e.clientX, y: e.clientY };
	console.log("[FS] pointerDown:", { shiftKey: e.shiftKey, shiftHeld, button: e.button });

	// Painting requires Shift to avoid conflict with orbit controls
	if (!e.shiftKey && !shiftHeld) return;

	// If no activeMesh, try to find one via raycast
	if (!activeMesh) {
		const model = getCurrentModel();
		if (model) {
			const renderer = getRenderer();
			const camera = getCamera();
			if (renderer && camera) {
				const rect = renderer.domElement.getBoundingClientRect();
				const mouse = new THREE.Vector2(
					((e.clientX - rect.left) / rect.width) * 2 - 1,
					-((e.clientY - rect.top) / rect.height) * 2 + 1,
				);
				const raycaster = new THREE.Raycaster();
				raycaster.setFromCamera(mouse, camera);
				const intersects = raycaster.intersectObject(model, true);
				if (intersects.length > 0 && (intersects[0].object as THREE.Mesh).isMesh) {
					activeMesh = intersects[0].object as THREE.Mesh;
					selectedFaceIndices.clear();
					updateBrushCursorSize();
					console.log("[FS] auto-activated mesh:", activeMesh.name);
				}
			}
		}
	}

	if (!activeMesh) {
		console.log("[FS] no mesh under cursor, can't paint");
		return;
	}

	// Disable orbit controls while painting
	import("./editor-main.js").then(({ getOrbitControls }) => {
		getOrbitControls().enabled = false;
	});

	// Determine paint vs erase
	if (e.ctrlKey || e.metaKey || e.button === 1) {
		erasing = true;
	} else {
		painting = true;
	}

	// Immediately paint at click point
	console.log("[FS] calling paintAtPosition, activeMesh:", activeMesh?.name);
	paintAtPosition(e.clientX, e.clientY);
	console.log("[FS] after paint, selectedFaceIndices.size:", selectedFaceIndices.size);
	updateOverlay();
}

export function onPointerUp(_e: PointerEvent): void {
	if (getMode() !== "face-select") return;
	if (painting || erasing) {
		// Re-enable orbit controls after painting
		import("./editor-main.js").then(({ getOrbitControls }) => {
			getOrbitControls().enabled = true;
		});
	}
	painting = false;
	erasing = false;
	// Don't clear pointerDownPos here — the click handler still needs it.
	// It will be cleared after the click event fires.
}

export function onPointerMove(e: PointerEvent): void {
	if (getMode() !== "face-select") return;
	lastMousePos = { x: e.clientX, y: e.clientY };
	updateBrushCursorPosition(e.clientX, e.clientY, e.shiftKey);
	updateBrushCursorSize();

	if (!painting && !erasing) return;
	console.log("[FS] pointerMove painting:", { painting, erasing, buttons: e.buttons });
	if (e.buttons === 0) {
		painting = false;
		erasing = false;
		pointerDownPos = null;
		import("./editor-main.js").then(({ getOrbitControls }) => {
			getOrbitControls().enabled = true;
		});
		return;
	}

	paintAtPosition(e.clientX, e.clientY);
	console.log("[FS] after move paint, selectedFaceIndices.size:", selectedFaceIndices.size);
	updateOverlay();
}

/** Handle scroll wheel for brush resize. Only active when Shift is held. Returns true if handled. */
export function handleWheel(e: WheelEvent): boolean {
	if (getMode() !== "face-select") return false;
	if (!e.shiftKey && !shiftHeld) return false;
	e.preventDefault();
	// Scroll down = bigger, scroll up = smaller
	let dy = e.deltaY;
	if (e.deltaMode === 1) dy *= 20;
	if (e.deltaMode === 2) dy *= 100;
	// wheelDelta: positive = scroll up (grow), negative = scroll down (shrink)
	const delta = (e.wheelDelta || 0) > 0 ? 0.01 : -0.01;
	setBrushRadius(brushRadius + delta);
	return true;
}

// ── Click handler — returns true if handled ──

export function handleFaceSelectClick(event: MouseEvent): boolean {
	if (getMode() !== "face-select") return false;
	if (event.shiftKey) {
		// Shift+click = painting handled by onPointerDown, don't interfere
		pointerDownPos = null;
		return true;
	}
	const model = getCurrentModel();
	if (!model) return false;
	if (event.button !== 0) return false;
	if (wasDrag(event)) {
		pointerDownPos = null;
		return false;
	}

	// Close dialog on empty-space click
	if (dialogEl) {
		const rect = dialogEl.getBoundingClientRect();
		if (event.clientX >= rect.left && event.clientX <= rect.right &&
			event.clientY >= rect.top && event.clientY <= rect.bottom) {
			pointerDownPos = null;
			return true;
		}
	}

	const renderer = getRenderer();
	const rect = renderer.domElement.getBoundingClientRect();
	const mouse = new THREE.Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-((event.clientY - rect.top) / rect.height) * 2 + 1,
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, getCamera());
	const intersects = raycaster.intersectObject(model, true);

	// No hit — clear selection and let orbit handle
	if (intersects.length === 0) {
		activeMesh = null;
		selectedFaceIndices.clear();
		overlayManager.clear();
		pointerDownPos = null;
		return false; // Let orbit handle empty-space clicks
	}

	const hitMesh = intersects[0].object as THREE.Mesh;
	if (!hitMesh.isMesh) return false;

	// Switch active mesh on click
	if (activeMesh !== hitMesh && !painting && !erasing) {
		activeMesh = hitMesh as THREE.Mesh;
		selectedFaceIndices.clear();
		updateBrushCursorSize();
	}

	// Select the clicked face (single-click without Shift = select one face)
	if (!painting && !erasing && intersects[0].face) {
		const faceIndex = intersects[0].faceIndex;
		if (faceIndex != null) {
			// Toggle: if already selected, deselect; otherwise select only this face
			if (selectedFaceIndices.has(faceIndex)) {
				selectedFaceIndices.delete(faceIndex);
			} else {
				selectedFaceIndices.clear();
				selectedFaceIndices.add(faceIndex);
			}
			updateOverlay();
		}
	}

	pointerDownPos = null;
	return true;
}

// ── Paint logic ──

function paintAtPosition(clientX: number, clientY: number): void {
	if (!activeMesh) {
		console.log("[FS] paintAtPosition: no activeMesh");
		return;
	}

	const geo = activeMesh.geometry;
	if (!geo.attributes.position || !geo.index) {
		console.log("[FS] paintAtPosition: mesh has no index or position attr");
		return;
	}

	const index = geo.index;
	const posAttr = geo.attributes.position;
	const camera = getCamera();
	const renderer = getRenderer();
	if (!camera || !renderer) return;

	const rect = renderer.domElement.getBoundingClientRect();

	// Get the ray
	const mouse = new THREE.Vector2(
		((clientX - rect.left) / rect.width) * 2 - 1,
		-((clientY - rect.top) / rect.height) * 2 + 1,
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, camera);

	// Raycast to find the hit point and painting plane
	const intersects = raycaster.intersectObject(activeMesh, false);
	console.log("[FS] paintAtPosition:", { mesh: activeMesh.name, intersects: intersects.length });
	if (intersects.length === 0) return;

	const hitPoint = intersects[0].point;

	// Convert brush pixel radius to world-space radius at the hit distance.
	// This is the INVERSE of what updateBrushCursorSize does, ensuring perfect 1:1 match.
	const cursorW = parseFloat(brushCursorEl?.style.width ?? "0") || 20;
	const brushPixelR = cursorW / 2;
	let brushWorldR: number;
	if (camera instanceof THREE.PerspectiveCamera) {
		const hitDist = camera.position.distanceTo(hitPoint);
		const fovRad = THREE.MathUtils.degToRad(camera.fov);
		const screenHeightWorld = 2 * Math.tan(fovRad / 2) * hitDist;
		// cursorW pixels = (cursorW / rect.height) fraction of screen
		// that fraction * screenHeightWorld = world diameter
		brushWorldR = (cursorW / rect.height) * screenHeightWorld / 2;
	} else {
		brushWorldR = brushPixelR * 0.01; // orthographic fallback
	}
	const brushWorldR2 = brushWorldR * brushWorldR;

	const faceCount = index.count / 3;

	for (let fi = 0; fi < faceCount; fi++) {
		const i0 = index.getX(fi * 3);
		const i1 = index.getX(fi * 3 + 1);
		const i2 = index.getX(fi * 3 + 2);

		const v0 = new THREE.Vector3(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
		const v1 = new THREE.Vector3(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
		const v2 = new THREE.Vector3(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));
		activeMesh.localToWorld(v0);
		activeMesh.localToWorld(v1);
		activeMesh.localToWorld(v2);

		// Check if any vertex or centroid is within brush world radius of hit point
		const centroid = v0.clone().add(v1).add(v2).divideScalar(3);
		let inside = false;
		for (const pt of [centroid, v0, v1, v2]) {
			const dx = pt.x - hitPoint.x;
			const dy = pt.y - hitPoint.y;
			const dz = pt.z - hitPoint.z;
			if (dx * dx + dy * dy + dz * dz <= brushWorldR2) {
				inside = true;
				break;
			}
		}

		if (inside) {
			if (erasing) {
				selectedFaceIndices.delete(fi);
			} else {
				selectedFaceIndices.add(fi);
			}
		}
	}
	console.log("[FS] paint done:", { totalFaces: faceCount, selected: selectedFaceIndices.size, brushWorldR, brushPixelR, brushRadius });
}

// ── Virtual group management ──

export function createVirtualGroup(name: string, markedAs: string | null): void {
	if (!activeMesh || selectedFaceIndices.size === 0) return;

	if (!activeMesh.userData.virtualGroups) {
		activeMesh.userData.virtualGroups = {};
	}

	const key = name.replace(/\s+/g, "_").toLowerCase();

	activeMesh.userData.virtualGroups[key] = {
		name,
		markedAs,
		faces: [...selectedFaceIndices].sort((a, b) => a - b),
	};

	selectedFaceIndices.clear();
	updateOverlay();
	refreshObjectPanel(getCurrentModel());

	console.log(
		`[face-select] Created virtual group "${name}" on "${activeMesh.name}" ` +
		`with ${activeMesh.userData.virtualGroups[key].faces.length} faces, markedAs=${markedAs}`,
	);
}

export function deleteVirtualGroup(mesh: THREE.Mesh, groupKey: string): void {
	if (!mesh.userData.virtualGroups) return;
	const group = mesh.userData.virtualGroups[groupKey];
	delete mesh.userData.virtualGroups[groupKey];
	if (Object.keys(mesh.userData.virtualGroups).length === 0) {
		delete mesh.userData.virtualGroups;
	}
	// If this mesh is the active mesh, remove group faces from selection
	if (activeMesh === mesh && group) {
		for (const fi of group.faces) {
			selectedFaceIndices.delete(fi);
		}
		updateOverlay();
	}
	refreshObjectPanel(getCurrentModel());
	console.log(`[face-select] Deleted virtual group "${groupKey}" from "${mesh.name}"`);
}

export function renameVirtualGroup(mesh: THREE.Mesh, groupKey: string, newName: string): void {
	if (!mesh.userData.virtualGroups?.[groupKey]) return;
	const group = mesh.userData.virtualGroups[groupKey];
	group.name = newName;
	const newKey = newName.replace(/\s+/g, "_").toLowerCase();
	if (newKey !== groupKey) {
		delete mesh.userData.virtualGroups[groupKey];
		mesh.userData.virtualGroups[newKey] = group;
	}
	refreshObjectPanel(getCurrentModel());
}

export function setVirtualGroupMark(mesh: THREE.Mesh, groupKey: string, markedAs: string | null): void {
	if (!mesh.userData.virtualGroups?.[groupKey]) return;
	mesh.userData.virtualGroups[groupKey].markedAs = markedAs;
	refreshObjectPanel(getCurrentModel());
}

export function getVirtualGroups(mesh: THREE.Mesh): Record<string, VirtualGroup> {
	return mesh.userData.virtualGroups ?? {};
}

/** Get all virtual groups across the entire model. */
export function getAllVirtualGroups(model: THREE.Group): Map<string, Record<string, VirtualGroup>> {
	const result = new Map<string, Record<string, VirtualGroup>>();
	model.traverse((child) => {
		if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).userData.virtualGroups) {
			result.set(child.uuid, (child as THREE.Mesh).userData.virtualGroups);
		}
	});
	return result;
}

/** Select all faces in a virtual group. */
export function selectVirtualGroup(mesh: THREE.Mesh, groupKey: string): void {
	const group = mesh.userData.virtualGroups?.[groupKey];
	if (!group) return;
	activeMesh = mesh;
	selectedFaceIndices = new Set(group.faces);
	updateOverlay();
}

/** Select faces by indices on a specific mesh. */
export function selectFaces(mesh: THREE.Mesh, faces: number[]): void {
	activeMesh = mesh;
	selectedFaceIndices = new Set(faces);
	updateOverlay();
}

// ── Group creation dialog ──

export function showGroupDialog(x: number, y: number): void {
	closeGroupDialog();
	if (selectedFaceIndices.size === 0) return;

	const menu = document.createElement("div");
	menu.className = "obj-context-menu";
	menu.id = "face-group-dialog";
	menu.style.minWidth = "200px";

	menu.innerHTML = `
		<div class="ctx-label">Create Virtual Group</div>
		<div style="padding:6px 8px;">
			<input type="text" id="vg-name" placeholder="Group name" style="
				width:100%;box-sizing:border-box;background:var(--ui-panel);border:1px solid var(--ui-border);
				border-radius:3px;color:var(--ui-text);padding:4px 6px;font-size:11px;font-family:var(--ui-sans);
			" />
		</div>
		<div style="padding:2px 8px;">
			<select id="vg-mark" style="
				width:100%;box-sizing:border-box;background:var(--ui-panel);border:1px solid var(--ui-border);
				border-radius:3px;color:var(--ui-text);padding:4px 6px;font-size:11px;font-family:var(--ui-sans);
			">
				<option value="">— No mark —</option>
				${MARK_AS_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join("")}
			</select>
		</div>
		<div style="padding:6px 8px;display:flex;gap:4px;">
			<button id="vg-create" class="btn" style="
				flex:1;background:var(--ui-accent);border:1px solid var(--ui-accent);
				border-radius:3px;color:#fff;padding:4px;font-size:11px;cursor:pointer;
			">Create</button>
			<button id="vg-cancel" class="btn" style="
				flex:1;background:var(--ui-panel);border:1px solid var(--ui-border);
				border-radius:3px;color:var(--ui-text);padding:4px;font-size:11px;cursor:pointer;
			">Cancel</button>
		</div>
		<div style="padding:2px 8px;font-size:10px;color:var(--ui-text-dim);">
			${selectedFaceIndices.size} faces selected
		</div>
	`;

	const menuW = 220;
	const menuH = 180;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let left = x;
	let top = y + 4;
	if (left + menuW > vw - 4) left = vw - menuW - 4;
	if (left < 4) left = 4;
	if (top + menuH > vh - 4) top = y - menuH - 4;
	if (top < 4) top = 4;
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;

	document.body.appendChild(menu);
	dialogEl = menu;

	const nameInput = menu.querySelector("#vg-name") as HTMLInputElement;
	const markSelect = menu.querySelector("#vg-mark") as HTMLSelectElement;
	const createBtn = menu.querySelector("#vg-create") as HTMLButtonElement;
	const cancelBtn = menu.querySelector("#vg-cancel") as HTMLButtonElement;

	nameInput.focus();

	const doCreate = () => {
		const name = nameInput.value.trim() || `Group_${Date.now() % 1000}`;
		const mark = markSelect.value || null;
		createVirtualGroup(name, mark);
		closeGroupDialog();
	};

	createBtn.addEventListener("click", doCreate);
	cancelBtn.addEventListener("click", closeGroupDialog);
	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") doCreate();
		if (e.key === "Escape") closeGroupDialog();
	});

	setTimeout(() => {
		const closer = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				closeGroupDialog();
				document.removeEventListener("mousedown", closer);
			}
		};
		document.addEventListener("mousedown", closer);
	}, 0);
}

export function closeGroupDialog(): void {
	dialogEl?.remove();
	dialogEl = null;
}

// ── Virtual group context menu (right-click on group in object panel) ──

export function showVirtualGroupContextMenu(
	anchor: HTMLElement,
	mesh: THREE.Mesh,
	groupKey: string,
): void {
	document.querySelector(".obj-context-menu")?.remove();
	closeGroupDialog();

	const group = mesh.userData.virtualGroups?.[groupKey];
	if (!group) return;

	const menu = document.createElement("div");
	menu.className = "obj-context-menu";

	menu.innerHTML = `
		<div class="ctx-label">${group.name}</div>
		<div class="ctx-item" data-vg-action="select">Select Faces</div>
		<div class="ctx-sep"></div>
		<div class="ctx-label">Mark As</div>
		${MARK_AS_OPTIONS.map(o => `<div class="ctx-item" data-vg-mark="${o.value}">${o.label}</div>`).join("")}
		<div class="ctx-item" data-vg-mark="">Clear Mark</div>
		<div class="ctx-sep"></div>
		<div class="ctx-item" data-vg-action="rename">Rename</div>
		<div class="ctx-item danger" data-vg-action="delete">Delete Group</div>
	`;

	const rect = anchor.getBoundingClientRect();
	const menuW = 160;
	const menuH = 280;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let left = rect.right + 4;
	let top = rect.top;
	if (left + menuW > vw) left = rect.left - menuW - 4;
	if (left < 0) left = 4;
	if (top + menuH > vh) top = vh - menuH - 4;
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
	document.body.appendChild(menu);

	for (const el of menu.querySelectorAll("[data-vg-mark]")) {
		el.addEventListener("click", () => {
			const val = (el as HTMLElement).dataset.vgMark || null;
			setVirtualGroupMark(mesh, groupKey, val);
			menu.remove();
		});
	}

	menu.querySelector("[data-vg-action=select]")?.addEventListener("click", () => {
		selectVirtualGroup(mesh, groupKey);
		menu.remove();
	});

	menu.querySelector("[data-vg-action=rename]")?.addEventListener("click", () => {
		menu.remove();
		const renameMenu = document.createElement("div");
		renameMenu.className = "obj-context-menu";
		renameMenu.style.left = `${left}px`;
		renameMenu.style.top = `${top}px`;
		renameMenu.innerHTML = `
			<div style="padding:6px 8px;">
				<input type="text" id="vg-rename-input" value="${group.name}" style="
					width:100%;box-sizing:border-box;background:var(--ui-panel);border:1px solid var(--ui-border);
					border-radius:3px;color:var(--ui-text);padding:4px 6px;font-size:11px;font-family:var(--ui-sans);
				" />
			</div>
		`;
		document.body.appendChild(renameMenu);
		const input = renameMenu.querySelector("#vg-rename-input") as HTMLInputElement;
		input.focus();
		input.select();
		const doRename = () => {
			const newName = input.value.trim();
			if (newName && newName !== group.name) {
				renameVirtualGroup(mesh, groupKey, newName);
			}
			renameMenu.remove();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") doRename();
			if (e.key === "Escape") renameMenu.remove();
		});
		setTimeout(() => {
			const closer = (e: MouseEvent) => {
				if (!renameMenu.contains(e.target as Node)) {
					doRename();
					document.removeEventListener("mousedown", closer);
				}
			};
			document.addEventListener("mousedown", closer);
		}, 0);
	});

	menu.querySelector("[data-vg-action=delete]")?.addEventListener("click", () => {
		deleteVirtualGroup(mesh, groupKey);
		menu.remove();
	});

	setTimeout(() => {
		const closer = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				document.removeEventListener("mousedown", closer);
			}
		};
		document.addEventListener("mousedown", closer);
	}, 0);
}

// ── Helpers ──

function wasDrag(e: MouseEvent): boolean {
	if (!pointerDownPos) return false;
	const dx = e.clientX - pointerDownPos.x;
	const dy = e.clientY - pointerDownPos.y;
	return Math.sqrt(dx * dx + dy * dy) > 5;
}

function updateOverlay(): void {
	if (activeMesh && selectedFaceIndices.size > 0) {
		overlayManager.update(activeMesh, selectedFaceIndices);
	} else {
		overlayManager.clear();
	}
}

/** Sync the overlay transform every frame (call from render loop). */
export function syncOverlay(): void {
	overlayManager.syncTransform();
}

/** Set face overlay visibility (synced with highlight toggle). */
export function setOverlayVisible(v: boolean): void {
	overlayManager.setVisible(v);
}
