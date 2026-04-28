/**
 * Sidebar for the dev-insights dashboard.
 *
 * Shows navigation sections: dependencies, schema, endpoints, violations.
 * Each section expands to show detailed content. Displays stats at the bottom.
 */

import type { DepcruiseResult } from "./types.ts";

interface TabContent {
	id: string;
	label: string;
	icon: string;
	badge: string;
	badgeClass: string;
}

export class Sidebar {
	private data: DepcruiseResult;

	constructor(data: DepcruiseResult, _graph?: unknown) {
		this.data = data;
		this.render();
	}

	private render() {
		// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
		const nav = document.getElementById("nav")!;
		// biome-ignore lint/style/noNonNullAssertion: DOM element guaranteed by HTML
		const stats = document.getElementById("stats")!;

		const tabs: TabContent[] = [
			{ id: "deps", label: "Dependencies", icon: "🔗", badge: `${this.data.modules.length} modules`, badgeClass: "" },
			{
				id: "violations",
				label: "Violations",
				icon: "⚠️",
				badge: `${this.countViolations()} issues`,
				badgeClass: this.countViolations() > 0 ? "err" : "",
			},
			{ id: "endpoints", label: "API Endpoints", icon: "🛣️", badge: "", badgeClass: "" },
			{ id: "schema", label: "DB Schema", icon: "🗄️", badge: "4 tables", badgeClass: "" },
		];

		nav.innerHTML = tabs.map((t) => this.renderTab(t)).join("");

		// Stats
		const clientCount = this.data.modules.filter((m) => m.source.includes("client/")).length;
		const serverCount = this.data.modules.filter((m) => m.source.includes("server/")).length;
		const sharedCount = this.data.modules.filter((m) => m.source.includes("shared/")).length;
		const totalDeps = this.data.modules.reduce((sum, m) => sum + m.dependencies.length, 0);

		stats.innerHTML = `
			<div class="stat-row"><span>modules</span><span class="stat-val">${this.data.modules.length}</span></div>
			<div class="stat-row"><span>dependencies</span><span class="stat-val">${totalDeps}</span></div>
			<div class="stat-row"><span>client</span><span class="stat-val" style="color:#5c9eff">${clientCount}</span></div>
			<div class="stat-row"><span>server</span><span class="stat-val" style="color:#a78bfa">${serverCount}</span></div>
			<div class="stat-row"><span>shared</span><span class="stat-val" style="color:#a3e635">${sharedCount}</span></div>
		`;

		// Tab click handlers
		for (const el of nav.querySelectorAll(".tab-header")) {
			el.addEventListener("click", () => {
				const tabId = el.getAttribute("data-tab");
				if (!tabId) return;

				const wasActive = el.classList.contains("active");

				// Toggle: if clicking active tab, close it
				for (const h of nav.querySelectorAll(".tab-header")) {
					h.classList.remove("active");
					const arrow = h.querySelector(".tab-arrow");
					if (arrow) arrow.textContent = "▸";
				}
				for (const p of nav.querySelectorAll(".tab-panel")) p.classList.remove("open");

				if (!wasActive) {
					el.classList.add("active");
					const arrow = el.querySelector(".tab-arrow");
					if (arrow) arrow.textContent = "▾";
					const panel = nav.querySelector(`.tab-panel[data-panel="${tabId}"]`);
					if (panel) panel.classList.add("open");

					// Lazy-load endpoints and schema on first open
					if (tabId === "endpoints") this.loadEndpointsPanel();
					if (tabId === "schema") this.loadSchemaPanel();
				}
			});
		}

		// Click on module/circular items to navigate in graph
		for (const el of nav.querySelectorAll("[data-goto]")) {
			el.addEventListener("click", () => {
				const id = el.getAttribute("data-goto");
				if (id) {
					// Close detail panel before navigating
					const detail = document.getElementById("detail");
					if (detail) detail.classList.remove("visible");
					window.dispatchEvent(new CustomEvent("graph:navigate", { detail: id }));
				}
			});
		}
	}

	private renderTab(tab: TabContent): string {
		const isActive = tab.id === "deps";
		let panel = "";

		switch (tab.id) {
			case "deps":
				panel = this.renderDepsPanel();
				break;
			case "violations":
				panel = this.renderViolationsPanel();
				break;
			case "endpoints":
				panel = '<div class="panel-empty">Click to load endpoints</div>';
				break;
			case "schema":
				panel = '<div class="panel-empty">Click to load schema</div>';
				break;
		}

		return `
			<div class="tab-header ${isActive ? "active" : ""}" data-tab="${tab.id}">
				<span>${tab.icon} ${tab.label}</span>
				${tab.badge ? `<span class="badge ${tab.badgeClass}">${tab.badge}</span>` : ""}
				<span class="tab-arrow">${isActive ? "▾" : "▸"}</span>
			</div>
			<div class="tab-panel ${isActive ? "open" : ""}" data-panel="${tab.id}">
				${panel}
			</div>
		`;
	}

	private renderDepsPanel(): string {
		const sorted = this.data.modules
			.map((m) => ({
				source: m.source,
				deps: m.dependencies.length,
				incoming: this.data.modules.filter((o) => o.dependencies.some((d) => d.resolved === m.source)).length,
			}))
			.sort((a, b) => b.deps + b.incoming - (a.deps + a.incoming))
			.slice(0, 15);

		return `
			<div class="panel-section">
				<div class="section-label">Most connected</div>
				${sorted
					.map(
						(m) =>
							`<div class="module-item" data-goto="${m.source}"><span class="mod-name">${this.shortLabel(m.source)}</span><span class="mod-stats">${m.deps}↓ ${m.incoming}↑</span></div>`,
					)
					.join("")}
			</div>
		`;
	}

	private renderViolationsPanel(): string {
		const circulars = this.getCircularDeps();
		if (circulars.length === 0) return '<div class="panel-empty">No violations ✓</div>';

		let html = '<div class="panel-section"><div class="section-label">Circular dependencies</div>';
		html += circulars
			.map(
				(c) =>
					`<div class="violation-item" data-goto="${c.from}"><span class="v-rule">⟳ circular</span><br><span class="v-from">${this.shortLabel(c.from)}</span> ↔ <span class="v-to">${this.shortLabel(c.to)}</span></div>`,
			)
			.join("");

		if (this.data.summary.rules) {
			const ruleViolations = this.data.summary.rules.filter((r) => r.name !== "no-circular" && r.name !== "no-orphans");
			if (ruleViolations.length > 0) {
				html += '<div class="section-label" style="margin-top:12px">Rule violations</div>';
				html += ruleViolations
					.map(
						(r) =>
							`<div class="violation-item"><span class="v-rule">${r.name}</span> — ${r.from.path || "*"} → ${r.to.path || "*"}</div>`,
					)
					.join("");
			}
		}
		html += "</div>";
		return html;
	}

	private async loadEndpointsPanel() {
		const panel = document.querySelector('.tab-panel[data-panel="endpoints"]');
		if (!panel || panel.getAttribute("data-loaded") === "true") return;

		try {
			const resp = await fetch("/api/dev-insights/endpoints");
			if (!resp.ok) {
				panel.innerHTML = '<div class="panel-empty">Failed to load</div>';
				return;
			}
			const data = await resp.json();
			const endpoints = data.endpoints || [];

			const groups = new Map<string, Array<{ method: string; path: string }>>();
			for (const ep of endpoints) {
				const prefix = ep.path.split("/").slice(0, 3).join("/");
				if (!groups.has(prefix)) groups.set(prefix, []);
				groups.get(prefix)?.push(ep);
			}

			let html = "";
			for (const [prefix, eps] of groups) {
				html += `<div class="section-label">${prefix}</div>`;
				html += eps
					.map((ep) => {
						const color =
							ep.method === "GET"
								? "#5c9eff"
								: ep.method === "POST"
									? "#a3e635"
									: ep.method === "DELETE"
										? "#f43f5e"
										: "#ff8c4b";
						const shortPath = ep.path.replace(prefix, "").replace(/^\//, "") || "/";
						return `<div class="endpoint-item"><span class="ep-method" style="color:${color}">${ep.method}</span> <span class="ep-path">${shortPath}</span></div>`;
					})
					.join("");
			}
			panel.innerHTML = html || '<div class="panel-empty">No endpoints found</div>';
			panel.setAttribute("data-loaded", "true");
		} catch {
			panel.innerHTML = '<div class="panel-empty">Error loading endpoints</div>';
		}
	}

	private async loadSchemaPanel() {
		const panel = document.querySelector('.tab-panel[data-panel="schema"]');
		if (!panel || panel.getAttribute("data-loaded") === "true") return;

		try {
			const resp = await fetch("/api/dev-insights/schema");
			if (!resp.ok) {
				panel.innerHTML = '<div class="panel-empty">Failed to load</div>';
				return;
			}
			const data = await resp.json();
			const tables = data.tables || [];

			panel.innerHTML = tables
				.map(
					({ name, columns }: { name: string; columns: Array<{ name: string; type: string; primary?: boolean }> }) =>
						`<div class="schema-table"><div class="schema-name">${name}</div>${columns.map((c: { name: string; type: string; primary?: boolean }) => `${c.primary ? ' <span class="col-pk">PK</span>' : ""}<div class="schema-col"><span class="col-name">${c.name}</span><span class="col-type">${c.type}</span></div>`).join("")}</div>`,
				)
				.join("");
			panel.setAttribute("data-loaded", "true");
		} catch {
			panel.innerHTML = '<div class="panel-empty">Error loading schema</div>';
		}
	}

	private countViolations(): number {
		let count = 0;
		const seen = new Set<string>();
		for (const mod of this.data.modules) {
			for (const dep of mod.dependencies) {
				if (dep.circular) {
					const key = [mod.source, dep.resolved].sort().join("↔");
					if (!seen.has(key)) {
						seen.add(key);
						count++;
					}
				}
			}
		}
		if (this.data.summary.rules) {
			count += this.data.summary.rules.filter((r) => r.name !== "no-circular" && r.name !== "no-orphans").length;
		}
		return count;
	}

	filter(query: string) {
		const modules = this.data.modules;
		const matching = query ? modules.filter((m) => m.source.toLowerCase().includes(query)).length : modules.length;
		const badge = document.querySelector('.tab-header[data-tab="deps"] .badge');
		if (badge) {
			badge.textContent = query ? `${matching}/${modules.length}` : `${modules.length} modules`;
		}
	}

	private getCircularDeps(): Array<{ from: string; to: string }> {
		const result: Array<{ from: string; to: string }> = [];
		const seen = new Set<string>();
		for (const mod of this.data.modules) {
			for (const dep of mod.dependencies) {
				if (dep.circular) {
					const key = [mod.source, dep.resolved].sort().join("↔");
					if (!seen.has(key)) {
						seen.add(key);
						result.push({ from: mod.source, to: dep.resolved });
					}
				}
			}
		}
		return result;
	}

	private shortLabel(source: string): string {
		const s = source.replace(/^src\//, "").replace(/\\/g, "/");
		const parts = s.split("/");
		if (parts.length > 2) return parts.slice(-2).join("/");
		return s;
	}
}
