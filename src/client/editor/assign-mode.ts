/**
 * Assign mode — pick a component type from dropdown, then click objects to assign.
 * Left click marks + selects (multi-select), clicking selected object deselects + unmarks.
 * Middle click removes mark. Orbit/drag navigation still works.
 */
import * as THREE from "three";
import { getCamera, getCurrentModel, getMode, getRenderer, setMode } from "./editor-main.js";
import { autoSetupLightMaterial, renameMaterialForBrakeDisc } from "./material-utils.js";
import { highlightObject, markObjectAs, unhighlightObject } from "./object-manager.js";
import { highlightListItem, refreshObjectPanel } from "./object-panel.js";

// ── Mouse position tracker (for dropdown positioning from keyboard) ──

let lastMouseX = 0;
let lastMouseY = 0;
document.addEventListener("mousemove", (e) => {
	lastMouseX = e.clientX;
	lastMouseY = e.clientY;
});
export function getLastMousePos(): { x: number; y: number } {
	return { x: lastMouseX, y: lastMouseY };
}

// ── Assign options ──

const ASSIGN_OPTIONS = [
	{ label: "Wheel FL", value: "wheel_FL", color: "#00ff88" },
	{ label: "Wheel FR", value: "wheel_FR", color: "#88ff00" },
	{ label: "Wheel RL", value: "wheel_RL", color: "#00ddcc" },
	{ label: "Wheel RR", value: "wheel_RR", color: "#ccdd00" },
	{ label: "Brake Disc FL", value: "brake_disc_FL", color: "#ff6644" },
	{ label: "Brake Disc FR", value: "brake_disc_FR", color: "#ffaa22" },
	{ label: "Brake Disc RL", value: "brake_disc_RL", color: "#ff4488" },
	{ label: "Brake Disc RR", value: "brake_disc_RR", color: "#ffcc44" },
	{ label: "Headlight", value: "headlight", color: "#aaccff" },
	{ label: "Taillight", value: "taillight", color: "#ff3344" },
];

// ── State ──

let activeAssignType: string | null = null;
let dropdownEl: HTMLDivElement | null = null;
let pointerDownPos: { x: number; y: number } | null = null;
const selectedUUIDs = new Set<string>();

export function getActiveAssignType(): string | null {
	return activeAssignType;
}

// ── Pointer tracking (distinguish clicks from orbit drags) ──

export function onPointerDown(e: PointerEvent): void {
	if (getMode() === "assign" && activeAssignType) {
		pointerDownPos = { x: e.clientX, y: e.clientY };
	}
}

function wasDrag(e: MouseEvent): boolean {
	if (!pointerDownPos) return true;
	const dx = e.clientX - pointerDownPos.x;
	const dy = e.clientY - pointerDownPos.y;
	return Math.sqrt(dx * dx + dy * dy) > 5;
}

// ── Selection management ──

function addToSelection(model: THREE.Group, uuid: string): void {
	if (selectedUUIDs.has(uuid)) return;
	selectedUUIDs.add(uuid);
	highlightObject(model, uuid);
	highlightListItem([...selectedUUIDs]);
}

function removeFromSelection(model: THREE.Group, uuid: string): void {
	if (!selectedUUIDs.has(uuid)) return;
	selectedUUIDs.delete(uuid);
	unhighlightObject(model, uuid);
	if (selectedUUIDs.size === 0) highlightListItem(null);
	else highlightListItem([...selectedUUIDs]);
}

function clearSelection(model: THREE.Group | null): void {
	if (!model) return;
	for (const uid of selectedUUIDs) unhighlightObject(model, uid);
	selectedUUIDs.clear();
	highlightListItem(null);
}

// ── Dropdown ──

export function openAssignDropdown(x: number, y: number): void {
	closeAssignDropdown();
	activeAssignType = null;

	const menu = document.createElement("div");
	menu.className = "obj-context-menu";
	menu.id = "assign-dropdown";
	menu.innerHTML = `
		<div class="ctx-label">Assign Component</div>
		${ASSIGN_OPTIONS.map((o) => `<div class="ctx-item" data-assign="${o.value}"><span class="assign-dot" style="background:${o.color}"></span>${o.label}</div>`).join("")}
		<div class="ctx-sep"></div>
		<div class="ctx-item" data-assign="">Cancel</div>
	`;

	// Clamp to viewport
	const menuW = 160,
		menuH = 300;
	const vw = window.innerWidth,
		vh = window.innerHeight;
	let left = x,
		top = y + 4;
	if (left + menuW > vw - 4) left = vw - menuW - 4;
	if (left < 4) left = 4;
	if (top + menuH > vh - 4) top = y - menuH - 4;
	if (top < 4) top = 4;
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;

	document.body.appendChild(menu);
	dropdownEl = menu;

	for (const el of menu.querySelectorAll("[data-assign]")) {
		el.addEventListener("click", () => {
			const val = (el as HTMLElement).dataset.assign || "";
			closeAssignDropdown();
			if (val) {
				activeAssignType = val;
				setMode("assign");
				document.dispatchEvent(
					new CustomEvent("assign-active", {
						detail: val.replace(/_/g, " "),
						bubbles: false,
					}),
				);
			}
		});
	}

	// Close on outside click
	setTimeout(() => {
		const closer = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				closeAssignDropdown();
				document.removeEventListener("mousedown", closer);
			}
		};
		document.addEventListener("mousedown", closer);
	}, 0);
}

export function closeAssignDropdown(): void {
	dropdownEl?.remove();
	dropdownEl = null;
}

export function exitAssignMode(): void {
	activeAssignType = null;
	closeAssignDropdown();
	clearSelection(getCurrentModel());
	document.dispatchEvent(new CustomEvent("assign-exit", { bubbles: false }));
	if (getMode() === "assign") setMode("select");
}

// ── Apply mark to a single object ──

function applyMark(model: THREE.Group, obj: THREE.Object3D, type: string | null): void {
	if (type === "headlight" || type === "taillight") {
		markObjectAs(model, obj.uuid, type);
		autoSetupLightMaterial(obj, type);
	} else if (type?.startsWith("brake_disc_")) {
		markObjectAs(model, obj.uuid, type);
		renameMaterialForBrakeDisc(obj);
	} else {
		markObjectAs(model, obj.uuid, type);
	}
}

// ── Click handler ──

export function handleAssignClick(event: MouseEvent): boolean {
	if (getMode() !== "assign" || !activeAssignType) return false;
	const model = getCurrentModel();
	if (!model) return false;
	if (event.button !== 0 && event.button !== 1) return false;
	if (wasDrag(event)) return false;

	const renderer = getRenderer();
	const rect = renderer.domElement.getBoundingClientRect();
	const mouse = new THREE.Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-((event.clientY - rect.top) / rect.height) * 2 + 1,
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, getCamera());
	const intersects = raycaster.intersectObject(model, true);

	if (intersects.length === 0) {
		// Clicked empty space — clear selection
		clearSelection(model);
		refreshObjectPanel(model);
		return true;
	}

	// Walk up to direct child of model root (the named object)
	let hit = intersects[0].object;
	while (hit.parent && hit.parent !== model) hit = hit.parent;
	if (!hit || hit === model) return false;

	const uuid = hit.uuid;

	if (event.button === 1) {
		// Middle click — remove mark + deselect
		applyMark(model, hit, null);
		removeFromSelection(model, uuid);
	} else {
		// Left click — toggle: mark + select, or unmark + deselect
		if (selectedUUIDs.has(uuid)) {
			applyMark(model, hit, null);
			removeFromSelection(model, uuid);
		} else {
			applyMark(model, hit, activeAssignType);
			addToSelection(model, uuid);
		}
	}

	refreshObjectPanel(model);

	// Sync highlight toggle state after manual assignment
	import("./editor-main.js").then(({ ensureHighlightsVisible }) => ensureHighlightsVisible());

	return true;
}
