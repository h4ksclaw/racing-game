import { css, html, LitElement } from "lit";

export class GameHud extends LitElement {
	static styles = css`
		:host {
			position: fixed;
			bottom: 24px;
			left: 50%;
			transform: translateX(-50%);
			display: flex;
			gap: 16px;
			align-items: flex-end;
			pointer-events: none;
			z-index: 100;
			font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
			--accent: #00e5a0;
			--warning: #ff6b35;
			--danger: #ff3355;
			--panel-bg: rgba(10, 12, 18, 0.75);
			--panel-border: rgba(255, 255, 255, 0.08);
			--panel-radius: 12px;
			--text-primary: #f0f2f5;
			--text-dim: rgba(240, 242, 245, 0.5);
		}

		:host([hidden]) { display: none; }

		.speed-panel {
			background: var(--panel-bg);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			border: 1px solid var(--panel-border);
			border-radius: var(--panel-radius);
			padding: 14px 24px;
			min-width: 140px;
			text-align: center;
		}

		.speed-value {
			font-size: 42px;
			font-weight: 700;
			color: var(--text-primary);
			line-height: 1;
			font-variant-numeric: tabular-nums;
			letter-spacing: -1px;
		}

		.speed-unit {
			font-size: 13px;
			color: var(--text-dim);
			font-weight: 500;
			letter-spacing: 2px;
			text-transform: uppercase;
			margin-top: 4px;
		}

		.rpm-bar-wrap {
			margin-top: 10px;
			height: 6px;
			background: rgba(255, 255, 255, 0.08);
			border-radius: 3px;
			overflow: hidden;
		}

		.rpm-bar {
			height: 100%;
			border-radius: 3px;
			background: linear-gradient(90deg, var(--accent), var(--warning), var(--danger));
			transition: width 0.05s linear;
		}

		.gear-panel {
			background: var(--panel-bg);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			border: 1px solid var(--panel-border);
			border-radius: var(--panel-radius);
			padding: 14px 20px;
			min-width: 52px;
			text-align: center;
		}

		.gear-value {
			font-size: 32px;
			font-weight: 700;
			color: var(--accent);
			line-height: 1;
			font-variant-numeric: tabular-nums;
		}

		.gear-value.reverse { color: var(--danger); }
		.gear-value.neutral { color: var(--text-dim); }

		.gear-label {
			font-size: 10px;
			color: var(--text-dim);
			letter-spacing: 2px;
			text-transform: uppercase;
			margin-top: 4px;
		}

		@media (max-width: 600px) {
			:host { bottom: 16px; gap: 10px; }
			.speed-value { font-size: 32px; }
			.gear-value { font-size: 24px; }
			.speed-panel { padding: 10px 16px; min-width: 110px; }
			.gear-panel { padding: 10px 14px; min-width: 44px; }
		}
	`;

	static properties = {
		speed: { type: Number },
		gear: { type: Number },
		rpm: { type: Number },
		hidden: { type: Boolean, reflect: true },
	};

	speed = 0;
	gear = 0;
	rpm = 0;
	hidden = false;

	render() {
		const gearClass = this.gear === -1 ? "reverse" : this.gear === 0 ? "neutral" : "";
		const gearDisplay = this.gear === -1 ? "R" : this.gear === 0 ? "N" : String(this.gear);
		const rpmPct = `${Math.max(0, Math.min(1, this.rpm)) * 100}%`;

		return html`
			<div class="speed-panel">
				<div class="speed-value">${Math.round(this.speed)}</div>
				<div class="speed-unit">km/h</div>
				<div class="rpm-bar-wrap">
					<div class="rpm-bar" style="width: ${rpmPct}"></div>
				</div>
			</div>
			<div class="gear-panel">
				<div class="gear-value ${gearClass}">${gearDisplay}</div>
				<div class="gear-label">gear</div>
			</div>
		`;
	}
}

customElements.define("game-hud", GameHud);
