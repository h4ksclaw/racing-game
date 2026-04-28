/**
 * Force-directed dependency graph renderer using Canvas2D.
 *
 * Uses a simple force simulation (repulsion + attraction + gravity)
 * to lay out the dependency graph. Supports pan, zoom, and node selection.
 */

import type { DepcruiseResult, GraphNode, GraphEdge } from "./types.ts";

const GROUP_COLORS = {
	client: "#5c9eff",
	server: "#a78bfa",
	shared: "#a3e635",
};

const VIOLATION_COLOR = "#f43f5e";
const HIGHLIGHT_ALPHA = 0.9;
const DIM_ALPHA = 0.08;

export class ForceGraph {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private nodes: Map<string, GraphNode> = new Map();
	private edges: GraphEdge[] = [];
	private violations: Map<string, Set<string>> = new Map(); // nodeId -> rule names

	// View transform
	private offsetX = 0;
	private offsetY = 0;
	private scale = 1;

	// Interaction
	private dragging: string | null = null;
	private panning = false;
	private panStartX = 0;
	private panStartY = 0;
	private panOffsetX = 0;
	private panOffsetY = 0;
	private selectedNode: string | null = null;
	private searchTerm = "";
	private matchSet: Set<string> = new Set();

	// Physics
	private cooling = 1;
	private layoutRunning = true;
	private alphaDecay = 0.998;

	constructor(canvas: HTMLCanvasElement, data: DepcruiseResult) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d")!;
		this.buildGraph(data);
		this.setupInteraction();
		this.resize();
		window.addEventListener("resize", () => this.resize());

		// Auto-fit after initial layout settles
		setTimeout(() => this.resetView(), 2000);
	}

	// ── Graph construction ─────────────────────────────────────────────

	private buildGraph(data: DepcruiseResult) {
		// Build nodes
		for (const mod of data.modules) {
			const id = mod.source;
			const group = this.classifyModule(id);
			this.nodes.set(id, {
				id,
				label: this.shortLabel(id),
				group,
				x: (Math.random() - 0.5) * 400,
				y: (Math.random() - 0.5) * 400,
				vx: 0,
				vy: 0,
				degree: 0,
				inDegree: 0,
				outDegree: 0,
				circular: !!mod.circular,
				violations: [],
			});
		}

		// Build edges
		for (const mod of data.modules) {
			const from = mod.source;
			for (const dep of mod.dependencies) {
				if (!dep.resolved) continue;
				const to = dep.resolved;
				const edge: GraphEdge = {
					source: from,
					target: to,
					circular: !!dep.circular,
					violation: false,
				};
				this.edges.push(edge);

				const fromNode = this.nodes.get(from);
				const toNode = this.nodes.get(to);
				if (fromNode) fromNode.outDegree++;
				if (toNode) toNode.inDegree++;
				if (fromNode) fromNode.degree++;
				if (toNode) toNode.degree++;
			}
		}

		// Track violations from summary rules
		if (data.summary.rules) {
			for (const rule of data.summary.rules) {
				if (rule.name === "no-circular" || rule.name === "no-orphans") continue;
				// Mark nodes that violate architecture rules
				for (const node of this.nodes.values()) {
					const matchFrom = rule.from.path && new RegExp(rule.from.path).test(node.id);
					if (matchFrom) {
						node.violations.push(rule.name);
						if (!this.violations.has(node.id)) this.violations.set(node.id, new Set());
						this.violations.get(node.id)!.add(rule.name);
					}
				}
			}
		}
	}

	private classifyModule(source: string): "client" | "server" | "shared" {
		if (source.includes("src/client/") || source.includes("src\\client\\")) return "client";
		if (source.includes("src/server/") || source.includes("src\\server\\")) return "server";
		if (source.includes("src/shared/") || source.includes("src\\shared\\")) return "shared";
		return "client";
	}

	private shortLabel(source: string): string {
		// Strip common prefixes
		let s = source.replace(/^src\//, "").replace(/\\/g, "/");
		// Show last 2-3 segments
		const parts = s.split("/");
		if (parts.length > 2) return parts.slice(-2).join("/");
		return s;
	}

	// ── Force simulation ───────────────────────────────────────────────

	tick() {
		if (!this.layoutRunning || this.cooling < 0.001) return;

		const nodes = Array.from(this.nodes.values());
		const k = Math.sqrt(8000 / nodes.length); // ideal distance
		const repulsionStrength = 600;
		const attractionStrength = 0.005;
		const gravityStrength = 0.01;

		// Repulsion (Coulomb)
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let dist = Math.sqrt(dx * dx + dy * dy) || 1;
				let force = (repulsionStrength * k * k) / dist;
				let fx = (dx / dist) * force;
				let fy = (dy / dist) * force;
				a.vx -= fx * this.cooling;
				a.vy -= fy * this.cooling;
				b.vx += fx * this.cooling;
				b.vy += fy * this.cooling;
			}
		}

		// Attraction (Hooke) along edges
		for (const edge of this.edges) {
			const a = this.nodes.get(edge.source);
			const b = this.nodes.get(edge.target);
			if (!a || !b) continue;
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			let dist = Math.sqrt(dx * dx + dy * dy) || 1;
			let force = (dist - k) * attractionStrength;
			let fx = (dx / dist) * force;
			let fy = (dy / dist) * force;
			a.vx += fx * this.cooling;
			a.vy += fy * this.cooling;
			b.vx -= fx * this.cooling;
			b.vy -= fy * this.cooling;
		}

		// Gravity toward center
		for (const node of nodes) {
			node.vx -= node.x * gravityStrength * this.cooling;
			node.vy -= node.y * gravityStrength * this.cooling;
		}

		// Apply velocity + damping
		const damping = 0.85;
		for (const node of nodes) {
			if (this.dragging === node.id) continue;
			node.vx *= damping;
			node.vy *= damping;
			node.x += node.vx;
			node.y += node.vy;
		}

		this.cooling *= this.alphaDecay;
	}

	// ── Rendering ──────────────────────────────────────────────────────

	draw() {
		const { ctx, canvas } = this;
		const w = canvas.width;
		const h = canvas.height;
		const dpr = window.devicePixelRatio || 1;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		// Background
		ctx.fillStyle = "#0d0f16";
		ctx.fillRect(0, 0, w, h);

		ctx.save();
		ctx.translate(w / 2 + this.offsetX, h / 2 + this.offsetY);
		ctx.scale(this.scale, this.scale);

		// Draw edges
		for (const edge of this.edges) {
			const a = this.nodes.get(edge.source);
			const b = this.nodes.get(edge.target);
			if (!a || !b) continue;

			const isHighlighted = this.isEdgeHighlighted(edge);
			ctx.strokeStyle = edge.circular
				? `rgba(244, 63, 94, ${isHighlighted ? 0.5 : 0.05})`
				: edge.violation
					? `rgba(244, 63, 94, ${isHighlighted ? 0.5 : 0.05})`
					: `rgba(92, 158, 255, ${isHighlighted ? 0.2 : 0.03})`;
			ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}

		// Draw nodes
		for (const node of this.nodes.values()) {
			const isSelected = node.id === this.selectedNode;
			const isMatch = this.searchTerm && this.matchSet.has(node.id);
			const isDim = this.searchTerm && !isMatch && !isSelected;
			const isViolation = node.violations.length > 0 || node.circular;
			const isHoverNeighbor = this.isNeighborOfSelected(node.id);

			const alpha = isDim ? DIM_ALPHA : isHoverNeighbor || isSelected || isMatch ? HIGHLIGHT_ALPHA : 0.5;
			const baseColor = isViolation ? VIOLATION_COLOR : GROUP_COLORS[node.group];
			const radius = this.nodeRadius(node);

			// Glow for selected/highlighted
			if (isSelected || isMatch) {
				ctx.beginPath();
				ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
				ctx.fillStyle = baseColor.replace(")", `, 0.15)`).replace("rgb", "rgba");
				ctx.fill();
			}

			// Node circle
			ctx.beginPath();
			ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
			ctx.fillStyle = baseColor;
			ctx.globalAlpha = alpha;
			ctx.fill();
			ctx.globalAlpha = 1;

			// Border for violations
			if (isViolation) {
				ctx.strokeStyle = VIOLATION_COLOR;
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			// Label
			if (this.scale > 0.4 || isSelected || isMatch) {
				ctx.font = `${isSelected || isMatch ? "11" : "9"}px 'JetBrains Mono', monospace`;
				ctx.fillStyle = `rgba(240, 244, 255, ${isDim ? 0.05 : isMatch || isSelected ? 0.95 : 0.4})`;
				ctx.textAlign = "center";
				ctx.fillText(node.label, node.x, node.y + radius + 12);
			}
		}

		ctx.restore();
	}

	private nodeRadius(node: GraphNode): number {
		return Math.max(3, Math.min(8, 2 + Math.log2(node.degree + 1) * 1.5));
	}

	private isEdgeHighlighted(edge: GraphEdge): boolean {
		if (!this.selectedNode && !this.searchTerm) return true;
		if (this.selectedNode) {
			return edge.source === this.selectedNode || edge.target === this.selectedNode;
		}
		if (this.searchTerm) {
			return this.matchSet.has(edge.source) || this.matchSet.has(edge.target);
		}
		return false;
	}

	private isNeighborOfSelected(nodeId: string): boolean {
		if (!this.selectedNode) return false;
		return this.edges.some(
			(e) =>
				(e.source === this.selectedNode && e.target === nodeId) ||
				(e.target === this.selectedNode && e.source === nodeId),
		);
	}

	// ── Interaction ────────────────────────────────────────────────────

	private resize() {
		const dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.ctx.scale(dpr, dpr);
	}

	private setupInteraction() {
		this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
		this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
		this.canvas.addEventListener("mouseup", () => this.onMouseUp());
		this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
		this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
	}

	private screenToWorld(sx: number, sy: number): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		const cx = rect.width / 2 + this.offsetX;
		const cy = rect.height / 2 + this.offsetY;
		return [(sx - cx) / this.scale, (sy - cy) / this.scale];
	}

	private findNodeAt(wx: number, wy: number): GraphNode | null {
		let closest: GraphNode | null = null;
		let closestDist = Infinity;
		for (const node of this.nodes.values()) {
			const dx = node.x - wx;
			const dy = node.y - wy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const r = this.nodeRadius(node) + 5;
			if (dist < r && dist < closestDist) {
				closest = node;
				closestDist = dist;
			}
		}
		return closest;
	}

	private onMouseDown(e: MouseEvent) {
		const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
		const node = this.findNodeAt(wx, wy);
		if (node) {
			this.dragging = node.id;
			this.cooling = Math.max(this.cooling, 0.1); // reheat
		} else {
			this.panning = true;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panOffsetX = this.offsetX;
			this.panOffsetY = this.offsetY;
		}
	}

	private onMouseMove(e: MouseEvent) {
		if (this.dragging) {
			const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
			const node = this.nodes.get(this.dragging);
			if (node) {
				node.x = wx;
				node.y = wy;
				node.vx = 0;
				node.vy = 0;
			}
		} else if (this.panning) {
			this.offsetX = this.panOffsetX + (e.clientX - this.panStartX);
			this.offsetY = this.panOffsetY + (e.clientY - this.panStartY);
		}
	}

	private onMouseUp() {
		this.dragging = null;
		this.panning = false;
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;
		this.zoom(factor);
	}

	private onDoubleClick(e: MouseEvent) {
		const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
		const node = this.findNodeAt(wx, wy);
		if (node) {
			this.selectNode(node.id);
			this.showNodeDetail(node);
		} else {
			this.selectNode(null);
			(document.getElementById("detail") as HTMLElement).classList.remove("visible");
		}
	}

	// ── Public API ─────────────────────────────────────────────────────

	selectNode(nodeId: string | null) {
		this.selectedNode = nodeId;
	}

	showNodeDetail(node: GraphNode) {
		const detail = document.getElementById("detail")!;
		const name = document.getElementById("detail-name")!;
		const body = document.getElementById("detail-body")!;

		name.textContent = node.id;

		const inDeps = this.edges.filter((e) => e.target === node.id).map((e) => this.nodes.get(e.source));
		const outDeps = this.edges.filter((e) => e.source === node.id).map((e) => this.nodes.get(e.target));

		body.innerHTML = `
			<table>
				<tr><td>Group</td><td style="color:${GROUP_COLORS[node.group]}">${node.group}</td></tr>
				<tr><td>Degree</td><td>${node.degree} (in: ${node.inDegree}, out: ${node.outDegree})</td></tr>
				<tr><td>Circular</td><td>${node.circular ? '<span style="color:var(--red)">Yes</span>' : "No"}</td></tr>
				${node.violations.length ? `<tr><td>Violations</td><td style="color:var(--red)">${node.violations.join(", ")}</td></tr>` : ""}
			</table>
			<div class="section-title">Depends On (${outDeps.filter(Boolean).length})</div>
			<ul class="dep-list">
				${outDeps
					.filter(Boolean)
					.map(
						(d) =>
							`<li style="color:${GROUP_COLORS[(d as GraphNode).group]}" onclick="window._navigateTo('${(d as GraphNode).id}')">${(d as GraphNode).label}</li>`,
					)
					.join("")}
			</ul>
			<div class="section-title">Depended By (${inDeps.filter(Boolean).length})</div>
			<ul class="dep-list">
				${inDeps
					.filter(Boolean)
					.map(
						(d) =>
							`<li style="color:${GROUP_COLORS[(d as GraphNode).group]}" onclick="window._navigateTo('${(d as GraphNode).id}')">${(d as GraphNode).label}</li>`,
					)
					.join("")}
			</ul>
		`;

		detail.classList.add("visible");
	}

	zoom(factor: number) {
		this.scale *= factor;
		this.scale = Math.max(0.1, Math.min(5, this.scale));
	}

	resetView() {
		this.scale = 1;
		this.offsetX = 0;
		this.offsetY = 0;

		// Auto-fit to node bounds
		const nodes = Array.from(this.nodes.values());
		if (nodes.length === 0) return;
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (const n of nodes) {
			minX = Math.min(minX, n.x);
			maxX = Math.max(maxX, n.x);
			minY = Math.min(minY, n.y);
			maxY = Math.max(maxY, n.y);
		}
		const padding = 100;
		const graphW = maxX - minX + padding * 2;
		const graphH = maxY - minY + padding * 2;
		const rect = this.canvas.getBoundingClientRect();
		const scaleX = rect.width / graphW;
		const scaleY = rect.height / graphH;
		this.scale = Math.min(scaleX, scaleY, 2);
		this.offsetX = -(minX + maxX) / 2 * this.scale;
		this.offsetY = -(minY + maxY) / 2 * this.scale;
	}

	toggleLayout() {
		this.cooling = 1;
		this.layoutRunning = true;
	}

	highlightMatching(term: string) {
		this.searchTerm = term.toLowerCase();
		this.matchSet.clear();
		if (term) {
			for (const node of this.nodes.values()) {
				if (node.id.toLowerCase().includes(this.searchTerm) || node.label.toLowerCase().includes(this.searchTerm)) {
					this.matchSet.add(node.id);
				}
			}
		}
	}

	getNodes(): GraphNode[] {
		return Array.from(this.nodes.values());
	}

	getEdges(): GraphEdge[] {
		return this.edges;
	}
}

// Global navigation helper for detail panel clicks
(window as any)._navigateTo = (nodeId: string) => {
	// Find and click the node in the graph
	const detail = document.getElementById("detail")!;
	detail.classList.remove("visible");
	// Dispatch a custom event that app.ts can pick up
	window.dispatchEvent(new CustomEvent("graph:navigate", { detail: nodeId }));
};
