/**
 * Object list UI panel — scene hierarchy outliner for the sidebar.
 */
import type * as THREE from "three";
import { getModelObjects, type ObjectInfo } from "./object-manager.js";

let container: HTMLElement;
let currentModel: THREE.Group | null = null;
let selectedUUID: string | null = null;

let selectCallback: ((uuid: string) => void) | null = null;
let markCallback: ((uuid: string, type: string | null) => void) | null = null;
let deleteCallback: ((uuid: string) => void) | null = null;

/** Initialize the object panel with a container element. */
export function initObjectPanel(el: HTMLElement): void {
	container = el;
}

/** Refresh the panel to reflect the current model state. */
export function refreshObjectPanel(model: THREE.Group | null): void {
	currentModel = model;
	if (!container) return;

	if (!model) {
		container.innerHTML = '<div style="color:var(--muted);font-size:11px;">No model loaded</div>';
		return;
	}

	const objects = getModelObjects(model);
	if (objects.length === 0) {
		container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Empty model</div>';
		return;
	}

	container.innerHTML = "";
	for (const obj of objects) {
		const div = document.createElement("div");
		div.className = `obj-item${obj.uuid === selectedUUID ? " selected" : ""}`;
		div.dataset.uuid = obj.uuid;

		const badge = obj.markedAs ? `<span class="obj-badge ${obj.markedAs}">${obj.markedAs}</span>` : "";
		const triCount = obj.type === "mesh" ? `${Math.round(obj.faceCount)}△` : "";

		div.innerHTML = `
			<button class="obj-vis-btn" title="Toggle visibility">${obj.visible ? "👁" : "👁‍🗨"}</button>
			<span class="obj-name" title="${obj.name}">${obj.name}</span>
			<span class="obj-tris">${triCount}</span>
			${badge}
			<button class="obj-actions-btn" title="Actions">⋯</button>
		`;

		// Select on click
		div.querySelector(".obj-name")?.addEventListener("click", () => {
			selectedUUID = obj.uuid;
			selectCallback?.(obj.uuid);
			refreshObjectPanel(model);
		});

		// Toggle visibility
		div.querySelector(".obj-vis-btn")?.addEventListener("click", () => {
			markCallback?.("_toggleVis", obj.uuid);
			refreshObjectPanel(model);
		});

		// Actions menu
		const actionsBtn = div.querySelector(".obj-actions-btn")!;
		actionsBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			showActionsMenu(actionsBtn as HTMLElement, obj);
		});

		container.appendChild(div);
	}
}

function showActionsMenu(anchor: HTMLElement, obj: ObjectInfo): void {
	// Remove any existing menu
	const existing = document.querySelector(".obj-context-menu");
	if (existing) existing.remove();

	const menu = document.createElement("div");
	menu.className = "obj-context-menu";

	const markOptions = [
		{ label: "Wheel FL", value: "wheel_FL" },
		{ label: "Wheel FR", value: "wheel_FR" },
		{ label: "Wheel RL", value: "wheel_RL" },
		{ label: "Wheel RR", value: "wheel_RR" },
		{ label: "Headlight", value: "headlight" },
		{ label: "Taillight", value: "taillight" },
		{ label: "Brake Disc", value: "brake_disc" },
		{ label: "— Clear Mark —", value: null },
	];

	menu.innerHTML = `
		<div class="ctx-label">Mark As</div>
		${markOptions.map((o) => `<div class="ctx-item" data-mark="${o.value ?? ""}">${o.label}</div>`).join("")}
		<div class="ctx-sep"></div>
		<div class="ctx-item" data-action="duplicate-mat">Duplicate Material (bloom)</div>
		<div class="ctx-sep"></div>
		<div class="ctx-item danger" data-action="delete">Delete</div>
	`;

	// Position near anchor
	const rect = anchor.getBoundingClientRect();
	menu.style.position = "fixed";
	menu.style.left = `${rect.right + 4}px`;
	menu.style.top = `${rect.top}px`;
	document.body.appendChild(menu);

	// Event handlers
	menu.querySelectorAll("[data-mark]").forEach((el) => {
		el.addEventListener("click", () => {
			const val = (el as HTMLElement).dataset.mark || null;
			markCallback?.(obj.uuid, val === "" ? null : val);
			menu.remove();
			refreshObjectPanel(currentModel);
		});
	});

	menu.querySelector("[data-action=duplicate-mat]")?.addEventListener("click", () => {
		markCallback?.("_dupMat", obj.uuid);
		menu.remove();
	});

	menu.querySelector("[data-action=delete]")?.addEventListener("click", () => {
		deleteCallback?.(obj.uuid);
		menu.remove();
		refreshObjectPanel(currentModel);
	});

	// Close on outside click
	setTimeout(() => {
		const closer = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				document.removeEventListener("click", closer);
			}
		};
		document.addEventListener("click", closer);
	}, 0);
}

/** Register callback when an object is selected in the panel. */
export function onObjectSelect(callback: (uuid: string) => void): void {
	selectCallback = callback;
}

/** Register callback for marking, visibility toggle, or material duplication. */
export function onObjectMark(callback: (uuid: string, type: string | null) => void): void {
	markCallback = callback;
}

/** Register callback for object deletion. */
export function onObjectDelete(callback: (uuid: string) => void): void {
	deleteCallback = callback;
}
