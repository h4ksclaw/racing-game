import { css, html, LitElement } from "lit";

export class ControlPanel extends LitElement {
	static styles = css`
		:host {
			position: fixed;
			top: 16px;
			right: 16px;
			z-index: 100;
			font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
			--panel-bg: rgba(10, 12, 18, 0.65);
			--panel-border: rgba(255, 255, 255, 0.08);
			--panel-radius: 10px;
			--text-dim: rgba(240, 242, 245, 0.55);
			--text-muted: rgba(240, 242, 245, 0.35);
			--accent: #00e5a0;
		}

		.panel {
			background: var(--panel-bg);
			backdrop-filter: blur(10px);
			-webkit-backdrop-filter: blur(10px);
			border: 1px solid var(--panel-border);
			border-radius: var(--panel-radius);
			padding: 12px 16px;
			font-size: 12px;
			line-height: 1.8;
			color: var(--text-dim);
		}

		.key {
			display: inline-block;
			background: rgba(255, 255, 255, 0.08);
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 4px;
			padding: 1px 6px;
			font-size: 11px;
			font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
			color: var(--text-dim);
			min-width: 22px;
			text-align: center;
		}

		.row {
			display: flex;
			justify-content: space-between;
			gap: 12px;
		}

		.action { color: var(--text-muted); }

		.actions {
			pointer-events: auto;
			margin-top: 10px;
			padding-top: 8px;
			border-top: 1px solid var(--panel-border);
		}

		.btn {
			display: block;
			width: 100%;
			padding: 7px 12px;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			color: var(--text-dim);
			font-size: 12px;
			text-decoration: none;
			cursor: pointer;
			transition: all 0.15s ease;
			text-align: center;
		}

		.btn:hover {
			background: rgba(0, 229, 160, 0.1);
			border-color: rgba(0, 229, 160, 0.3);
			color: var(--accent);
		}

		@media (max-width: 600px) {
			:host { top: 8px; right: 8px; }
			.panel { font-size: 11px; padding: 10px 12px; }
		}
	`;

	render() {
		return html`
			<div class="panel">
				<div class="row"><span class="key">W</span><span class="key">↑</span><span class="action">Throttle</span></div>
				<div class="row"><span class="key">S</span><span class="key">↓</span><span class="action">Brake</span></div>
				<div class="row"><span class="key">A</span><span class="key">←</span><span class="action">Steer Left</span></div>
				<div class="row"><span class="key">D</span><span class="key">→</span><span class="action">Steer Right</span></div>
				<div class="row"><span class="key">Space</span><span class="action">Handbrake</span></div>
				<div class="row"><span class="key">R</span><span class="action">Reset</span></div>
				<div class="actions">
					<a class="btn" href="/world" @click=${this._navWorld}>← Back to World</a>
				</div>
			</div>
		`;
	}

	private _navWorld(e: Event) {
		e.preventDefault();
		const params = new URLSearchParams(window.location.search);
		window.location.href = `/world?${params.toString()}`;
	}
}

customElements.define("control-panel", ControlPanel);
