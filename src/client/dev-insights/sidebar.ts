/**
 * Sidebar for the dev-insights dashboard.
 *
 * Shows navigation sections: dependencies, schema, endpoints, violations.
 * Displays stats at the bottom.
 */

import type { DepcruiseResult } from "./types.ts";

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

		// Navigation sections
		const sections = [
			{
				id: "deps",
				label: "Dependencies",
				icon: "🔗",
				badge: `${this.data.modules.length} modules`,
				badgeClass: "",
			},
			{
				id: "violations",
				label: "Violations",
				icon: "⚠️",
				badge: `${this.countViolations()} issues`,
				badgeClass: this.countViolations() > 0 ? "err" : "",
			},
			{
				id: "endpoints",
				label: "API Endpoints",
				icon: "🛣️",
				badge: "",
				badgeClass: "",
			},
			{
				id: "schema",
				label: "DB Schema",
				icon: "🗄️",
				badge: "4 tables",
				badgeClass: "",
			},
		];

		nav.innerHTML = sections
			.map(
				(s) => `
			<div class="nav-item ${s.id === "deps" ? "active" : ""}" data-section="${s.id}">
				<span>${s.icon} ${s.label}</span>
				${s.badge ? `<span class="badge ${s.badgeClass}">${s.badge}</span>` : ""}
			</div>
		`,
			)
			.join("");

		// Add violations list if any
		if (this.data.summary.rules && this.data.summary.rules.length > 0) {
			const violationsHtml = this.data.summary.rules
				.map(
					(r) => `
				<div class="violation-item">
					<span class="v-rule">${r.name}</span> — ${r.from.path || "*"} → ${r.to.path || "*"}
				</div>
			`,
				)
				.join("");
			nav.innerHTML += violationsHtml;
		}

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

		// Nav click handlers
		for (const el of nav.querySelectorAll(".nav-item")) {
			el.addEventListener("click", () => {
				for (const n of nav.querySelectorAll(".nav-item")) n.classList.remove("active");
				el.classList.add("active");
			});
		}
	}

	private countViolations(): number {
		if (!this.data.summary.rules) return 0;
		return this.data.summary.rules.filter((r) => r.name !== "no-circular" && r.name !== "no-orphans").length;
	}

	filter(query: string) {
		// Update nav badges with filtered count
		const modules = this.data.modules;
		const matching = query ? modules.filter((m) => m.source.toLowerCase().includes(query)).length : modules.length;
		const badge = document.querySelector('.nav-item[data-section="deps"] .badge');
		if (badge) {
			badge.textContent = query ? `${matching}/${modules.length}` : `${modules.length} modules`;
		}
	}
}
