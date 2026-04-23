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

export function initObjectPanel(el: HTMLElement): void {
	container = el;
}

export function refreshObjectPanel(model: THREE.Group | null): void {
	currentModel = model;
	if (!container) return;

	if (!model) {
		container.innerHTML = '<div style="color:var(--ui-text);font-size:11px;">No model loaded</div>';
		return;
	}

	const objects = getModelObjects(model);
	if (objects.length === 0) {
		container.innerHTML = '<div style="color:var(--ui-text);font-size:11px;">Empty model</div>';
		return;
	}

	container.innerHTML = "";
	for (const obj of objects) {
		const div = document.createElement("div");
		div.className = `obj-item${obj.uuid === selectedUUID ? " selected" : ""}`;
		div.dataset.uuid = obj.uuid;

		const badgeLabel = obj.markedAs?.replace(/^brake_disc_/, "BD ") ?? obj.markedAs;
		const badge = badgeLabel ? `<span class="obj-badge ${obj.markedAs}">${badgeLabel}</span>` : "";
		const triCount = obj.type === "mesh" ? `${Math.round(obj.faceCount)} tris` : "";

		div.innerHTML = `
			<button class="obj-vis-btn" title="Toggle visibility">${obj.visible ? "vis" : "hid"}</button>
			<span class="obj-name" title="${obj.name}">${obj.name}</span>
			<span class="obj-tris">${triCount}</span>
			${badge}
			<button class="obj-actions-btn" title="Actions">...</button>
		`;

		div.querySelector(".obj-name")?.addEventListener("click", () => {
			selectedUUID = obj.uuid;
			selectCallback?.(obj.uuid);
			refreshObjectPanel(model);
		});

		div.querySelector(".obj-vis-btn")?.addEventListener("click", () => {
			markCallback?.("_toggleVis", obj.uuid);
			refreshObjectPanel(model);
		});

		const actionsBtn = div.querySelector<HTMLButtonElement>(".obj-actions-btn");
		actionsBtn?.addEventListener("click", (e) => {
			e.stopPropagation();
			if (actionsBtn) showActionsMenu(actionsBtn, obj);
		});

		container.appendChild(div);
	}
}

function showActionsMenu(anchor: HTMLElement, obj: ObjectInfo): void {
	document.querySelector(".obj-context-menu")?.remove();

	const menu = document.createElement("div");
	menu.className = "obj-context-menu";

	const markOptions = [
		{ label: "Wheel FL", value: "wheel_FL" },
		{ label: "Wheel FR", value: "wheel_FR" },
		{ label: "Wheel RL", value: "wheel_RL" },
		{ label: "Wheel RR", value: "wheel_RR" },
		{ label: "Brake Disc FL", value: "brake_disc_FL" },
		{ label: "Brake Disc FR", value: "brake_disc_FR" },
		{ label: "Brake Disc RL", value: "brake_disc_RL" },
		{ label: "Brake Disc RR", value: "brake_disc_RR" },
		{ label: "Headlight", value: "headlight" },
		{ label: "Taillight", value: "taillight" },
		{ label: "-- Clear Mark --", value: null },
	];

	menu.innerHTML = `
		<div class="ctx-label">Mark As</div>
		${markOptions.map((o) => `<div class="ctx-item" data-mark="${o.value ?? ""}">${o.label}</div>`).join("")}
		<div class="ctx-sep"></div>
		<div class="ctx-item danger" data-action="delete">Delete</div>
	`;

	const rect = anchor.getBoundingClientRect();
	const menuW = 160;
	const menuH = 320;
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

	for (const el of menu.querySelectorAll("[data-mark]")) {
		el.addEventListener("click", () => {
			const val = (el as HTMLElement).dataset.mark || null;
			markCallback?.(obj.uuid, val === "" ? null : val);
			menu.remove();
			refreshObjectPanel(currentModel);
		});
	}

	menu.querySelector("[data-action=delete]")?.addEventListener("click", () => {
		deleteCallback?.(obj.uuid);
		menu.remove();
		refreshObjectPanel(currentModel);
	});

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

export function onObjectSelect(callback: (uuid: string) => void): void {
	selectCallback = callback;
}
export function onObjectMark(callback: (uuid: string, type: string | null) => void): void {
	markCallback = callback;
}
export function onObjectDelete(callback: (uuid: string) => void): void {
	deleteCallback = callback;
}

/** Called when selection changes externally (e.g. 3D viewport click). */
export function highlightListItem(uuids: string | string[] | null): void {
	const set = uuids == null ? new Set<string>() : Array.isArray(uuids) ? new Set(uuids) : new Set([uuids]);
	selectedUUID = set.size === 1 ? [...set][0] : null;
	if (!container || !currentModel) return;

	for (const item of container.querySelectorAll<HTMLElement>(".obj-item")) {
		item.classList.toggle("selected", set.has(item.dataset.uuid ?? ""));
	}

	// Scroll the last added item into view
	if (uuids) {
		const last = Array.isArray(uuids) ? uuids[uuids.length - 1] : uuids;
		const el = container.querySelector<HTMLElement>(`.obj-item[data-uuid="${last}"]`);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "nearest" });
		el.classList.add("blink");
		setTimeout(() => el.classList.remove("blink"), 1200);
	}
}
