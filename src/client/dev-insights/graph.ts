/**
 * Force-directed dependency graph renderer using Canvas2D.
 *
 * Uses a simple force simulation (repulsion + attraction + gravity)
 * to lay out the dependency graph. Supports pan, zoom, and node selection.
 */

import type { DepcruiseResult, GraphEdge, GraphNode } from "./types.ts";

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
	private mouseDownX = 0;
	private mouseDownY = 0;
	private mouseDownNodeId: string | null = null;
	private isDragThresholdReached = false;
	private static readonly DRAG_THRESHOLD = 3;

	// Physics
	private cooling = 1;
	private layoutRunning = true;
	private layoutFrozen = false; // once true, tick() is a no-op
	private alphaDecay = 0.98; // fast cooldown — layout settles in ~3s

	constructor(canvas: HTMLCanvasElement, data: DepcruiseResult) {
		this.canvas = canvas;
		// biome-ignore lint/style/noNonNullAssertion: HTMLCanvasElement always has 2d context
		this.ctx = canvas.getContext("2d")!;
		this.buildGraph(data);
		this.setupInteraction();
		this.resize();
		window.addEventListener("resize", () => this.resize());

		// Auto-fit once layout cools down
		this.waitForLayout(() => this.resetView());
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
						this.violations.get(node.id)?.add(rule.name);
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
		const s = source.replace(/^src\//, "").replace(/\\/g, "/");
		// Show last 2-3 segments
		const parts = s.split("/");
		if (parts.length > 2) return parts.slice(-2).join("/");
		return s;
	}

	// ── Force simulation ───────────────────────────────────────────────

	tick() {
		if (this.layoutFrozen) return;
		if (!this.layoutRunning || this.cooling < 0.005) {
			this.layoutFrozen = true;
			return;
		}

		const nodes = Array.from(this.nodes.values());
		const k = Math.sqrt(6000 / nodes.length); // ideal distance
		const repulsionStrength = 200;
		const attractionStrength = 0.008;
		const gravityStrength = 0.02;

		// Repulsion (Coulomb)
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				const force = (repulsionStrength * k * k) / dist;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
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
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.sqrt(dx * dx + dy * dy) || 1;
			const force = (dist - k) * attractionStrength;
			const fx = (dx / dist) * force;
			const fy = (dy / dist) * force;
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

			const alpha = isDim ? DIM_ALPHA : isHoverNeighbor || isSelected || isMatch ? HIGHLIGHT_ALPHA : 0.6;
			const baseColor = isViolation ? VIOLATION_COLOR : GROUP_COLORS[node.group];
			const radius = this.nodeRadius(node);

			// Glow for selected/highlighted
			if (isSelected || isMatch) {
				ctx.beginPath();
				ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
				ctx.fillStyle = baseColor.replace(")", ", 0.15)").replace("rgb", "rgba");
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

			// Label — show at readable zoom, scale font with zoom level
			const labelAlpha = isDim ? 0.05 : isMatch || isSelected ? 0.95 : 0.7;
			if (this.scale > 0.15 || isSelected || isMatch) {
				const fontSize = isSelected || isMatch ? 12 : this.scale > 0.5 ? 10 : 8;
				ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
				ctx.fillStyle = `rgba(240, 244, 255, ${labelAlpha})`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.fillText(node.label, node.x, node.y + radius + 4);
			}
		}

		ctx.restore();
	}

	private nodeRadius(node: GraphNode): number {
		// Bigger base size so nodes are visible without zooming
		return Math.max(5, Math.min(14, 4 + Math.log2(node.degree + 1) * 2));
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
		const hitRadius = 20 / this.scale; // 20 screen pixels in world units
		for (const node of this.nodes.values()) {
			const dx = node.x - wx;
			const dy = node.y - wy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < hitRadius && dist < closestDist) {
				closest = node;
				closestDist = dist;
			}
		}
		return closest;
	}

	private onMouseDown(e: MouseEvent) {
		this.mouseDownX = e.clientX;
		this.mouseDownY = e.clientY;
		this.isDragThresholdReached = false;

		const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
		const node = this.findNodeAt(wx, wy);
		if (node) {
			// Select immediately, but don't start dragging until threshold
			this.mouseDownNodeId = node.id;
			this.selectNode(node.id);
			this.showNodeDetail(node);
		} else {
			this.mouseDownNodeId = null;
			// Click on empty space deselects
			this.selectNode(null);
			(document.getElementById("detail") as HTMLElement).classList.remove("visible");
			this.panning = true;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panOffsetX = this.offsetX;
			this.panOffsetY = this.offsetY;
		}
	}

	private onMouseMove(e: MouseEvent) {
		// Check if mouse has moved beyond drag threshold
		if (this.mouseDownNodeId && !this.isDragThresholdReached) {
			const dx = e.clientX - this.mouseDownX;
			const dy = e.clientY - this.mouseDownY;
			if (dx * dx + dy * dy > ForceGraph.DRAG_THRESHOLD * ForceGraph.DRAG_THRESHOLD) {
				this.isDragThresholdReached = true;
				this.dragging = this.mouseDownNodeId;
				this.cooling = Math.max(this.cooling, 0.1); // reheat
			}
		}

		// Update cursor for hover feedback
		if (!this.dragging && !this.panning) {
			const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
			const hovered = this.findNodeAt(wx, wy);
			this.canvas.style.cursor = hovered ? "pointer" : "grab";
		}

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
		this.mouseDownNodeId = null;
		this.isDragThresholdReached = false;
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;

		// Zoom toward cursor position
		const rect = this.canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// World coords under cursor before zoom
		const cx = rect.width / 2 + this.offsetX;
		const cy = rect.height / 2 + this.offsetY;
		const wx = (mx - cx) / this.scale;
		const wy = (my - cy) / this.scale;

		// Apply zoom
		this.scale *= factor;
		this.scale = Math.max(0.05, Math.min(20, this.scale));

		// Adjust offset so the same world point stays under cursor
		this.offsetX = mx - rect.width / 2 - wx * this.scale;
		this.offsetY = my - rect.height / 2 - wy * this.scale;
	}

	private onDoubleClick(e: MouseEvent) {
		const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
		const node = this.findNodeAt(wx, wy);
		if (node) {
			// Double-click opens in GitHub
			window.open(`https://github.com/h4ksclaw/racing-game/blob/feat/code-intelligence/${node.id}`, "_blank");
		}
	}

	// ── Public API ─────────────────────────────────────────────────────

	selectNode(nodeId: string | null) {
		this.selectedNode = nodeId;
	}

	navigateToNode(nodeId: string) {
		const node = this.nodes.get(nodeId);
		if (!node) return;
		this.selectNode(nodeId);
		this.showNodeDetail(node);

		// Pan to center the node on screen
		this.offsetX = -node.x * this.scale;
		this.offsetY = -node.y * this.scale;
	}

	showNodeDetail(node: GraphNode) {
		// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
		const detail = document.getElementById("detail")!;
		// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
		const name = document.getElementById("detail-name")!;
		// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
		const body = document.getElementById("detail-body")!;

		name.textContent = node.id;

		const githubUrl = `https://github.com/h4ksclaw/racing-game/blob/feat/code-intelligence/${node.id}`;
		const inDeps = this.edges.filter((e) => e.target === node.id).map((e) => this.nodes.get(e.source));
		const outDeps = this.edges.filter((e) => e.source === node.id).map((e) => this.nodes.get(e.target));

		body.innerHTML = `
			<a href="${githubUrl}" target="_blank" class="github-link" title="Open on GitHub">${node.id} ↗</a>
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

	private waitForLayout(cb: () => void) {
		if (this.layoutFrozen) {
			cb();
			return;
		}
		requestAnimationFrame(() => this.waitForLayout(cb));
	}

	zoom(factor: number) {
		this.scale *= factor;
		this.scale = Math.max(0.05, Math.min(20, this.scale));
	}

	resetView() {
		this.offsetX = 0;
		this.offsetY = 0;

		// Auto-fit to node bounds
		const nodes = Array.from(this.nodes.values());
		if (nodes.length === 0) return;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const n of nodes) {
			minX = Math.min(minX, n.x);
			maxX = Math.max(maxX, n.x);
			minY = Math.min(minY, n.y);
			maxY = Math.max(maxY, n.y);
		}
		const padding = 150;
		const graphW = maxX - minX + padding * 2;
		const graphH = maxY - minY + padding * 2;
		const rect = this.canvas.getBoundingClientRect();
		const scaleX = rect.width / graphW;
		const scaleY = rect.height / graphH;
		this.scale = Math.min(scaleX, scaleY, 2);
		this.offsetX = (-(minX + maxX) / 2) * this.scale;
		this.offsetY = (-(minY + maxY) / 2) * this.scale;
	}

	toggleLayout() {
		this.layoutFrozen = false;
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
(window as unknown as Record<string, unknown>)._navigateTo = (nodeId: string) => {
	// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
	const detail = document.getElementById("detail")!;
	detail.classList.remove("visible");
	// Dispatch a custom event that app.ts can pick up
	window.dispatchEvent(new CustomEvent("graph:navigate", { detail: nodeId }));
};
