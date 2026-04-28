/**
 * Dev Insights — Code Intelligence Dashboard
 *
 * Visualizes dependency graph, API endpoints, DB schema, and violations.
 * Data sourced from dependency-cruiser JSON and Drizzle schema.
 */

import type { DepcruiseResult } from "./types.ts";
import { ForceGraph } from "./graph.ts";
import { Sidebar } from "./sidebar.ts";

const loading = document.getElementById("loading")!;
const canvas = document.getElementById("graph-canvas") as HTMLCanvasElement;

let graph: ForceGraph;
let sidebar: Sidebar;
let depData: DepcruiseResult | null = null;

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

	// Start render loop
	loading.classList.add("hidden");
	requestAnimationFrame(renderLoop);
}

function renderLoop() {
	graph.tick();
	graph.draw();
	requestAnimationFrame(renderLoop);
}

// ── Toolbar actions ──
(window as any).zoomIn = () => graph.zoom(1.3);
(window as any).zoomOut = () => graph.zoom(0.7);
(window as any).resetView = () => graph.resetView();
(window as any).toggleLayout = () => graph.toggleLayout();
(window as any).hideDetail = () => {
	document.getElementById("detail")!.classList.remove("visible");
	graph.selectNode(null);
};

init();
