/**
 * Dev Insights — Code Intelligence Dashboard
 *
 * Visualizes dependency graph, API endpoints, DB schema, and violations.
 * Data sourced from dependency-cruiser JSON and Drizzle schema.
 */

import type { SchemaData } from "./er-diagram.ts";
import { ERDiagram } from "./er-diagram.ts";
import { ForceGraph } from "./graph.ts";
import { Sidebar } from "./sidebar.ts";
import type { DepcruiseResult } from "./types.ts";

// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
const loading = document.getElementById("loading")!;
const canvas = document.getElementById("graph-canvas") as HTMLCanvasElement;

let graph: ForceGraph;
let sidebar: Sidebar;
let erDiagram: ERDiagram | null = null;
let depData: DepcruiseResult | null = null;

// View mode: "deps" or "schema"
let currentView: "deps" | "schema" = "deps";

async function init() {
	// Fetch dependency data
	const resp = await fetch("/api/dev-insights/dependencies");
	if (!resp.ok) {
		loading.textContent = `Error loading: ${resp.status} ${resp.statusText}`;
		return;
	}
	depData = await resp.json();

	// Initialize components
	if (!depData) return;
	graph = new ForceGraph(canvas, depData);
	sidebar = new Sidebar(depData, graph);

	// Wire search
	const searchInput = document.getElementById("search") as HTMLInputElement;
	searchInput.addEventListener("input", () => {
		const q = searchInput.value.toLowerCase();
		sidebar.filter(q);
		graph.highlightMatching(q);
	});

	// Wire node navigation from detail panel clicks
	window.addEventListener("graph:navigate", ((e: CustomEvent) => {
		graph.navigateToNode(e.detail);
	}) as EventListener);

	// Wire view switcher
	setupViewSwitcher();

	// Start render loop
	loading.classList.add("hidden");
	requestAnimationFrame(renderLoop);
}

function setupViewSwitcher() {
	const btnDeps = document.getElementById("view-deps");
	const btnSchema = document.getElementById("view-schema");
	if (!btnDeps || !btnSchema) return;

	btnDeps.addEventListener("click", () => switchView("deps"));
	btnSchema.addEventListener("click", () => switchView("schema"));
}

async function switchView(view: "deps" | "schema") {
	if (view === currentView) return;
	currentView = view;

	// Update button states
	const btnDeps = document.getElementById("view-deps");
	const btnSchema = document.getElementById("view-schema");
	if (btnDeps) btnDeps.classList.toggle("active", view === "deps");
	if (btnSchema) btnSchema.classList.toggle("active", view === "schema");

	// Hide detail panel
	// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
	document.getElementById("detail")!.classList.remove("visible");

	if (view === "schema") {
		// Load schema data if not yet loaded
		if (!erDiagram) {
			try {
				const resp = await fetch("/api/dev-insights/schema");
				if (resp.ok) {
					const data = (await resp.json()) as SchemaData;
					erDiagram = new ERDiagram(canvas, data);
					// Need to wait a frame for resize to take effect
					requestAnimationFrame(() => erDiagram?.resetView());
				}
			} catch {
				// If schema fails, stay on deps view
				currentView = "deps";
				if (btnDeps) btnDeps.classList.add("active");
				if (btnSchema) btnSchema.classList.remove("active");
			}
		}
	} else {
		// Re-fit graph when switching back
		graph.resetView();
	}
}

function renderLoop() {
	if (currentView === "deps") {
		graph.tick();
		graph.draw();
	} else if (erDiagram) {
		erDiagram.draw();
	}
	requestAnimationFrame(renderLoop);
}

// ── Toolbar actions ──
const win = window as unknown as Record<string, (...args: unknown[]) => void>;
win.zoomIn = () => {
	if (currentView === "deps") graph.zoom(1.3);
	else if (erDiagram) erDiagram.zoom(1.3);
};
win.zoomOut = () => {
	if (currentView === "deps") graph.zoom(0.7);
	else if (erDiagram) erDiagram.zoom(0.7);
};
win.resetView = () => {
	if (currentView === "deps") graph.resetView();
	else if (erDiagram) erDiagram.resetView();
};
win.hideDetail = () => {
	// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
	document.getElementById("detail")!.classList.remove("visible");
	graph.selectNode(null);
};

init();
