import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class DamageBar extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				gap: 8px;
				position: fixed;
				bottom: 72px;
				left: 16px;
				z-index: 100;
				pointer-events: none;
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 6px 12px;
			}
			.lbl {
				font-family: var(--ui-mono);
				font-size: 8px;
				color: rgba(139,92,246,0.2);
				letter-spacing: 2px;
			}
			.bar-track {
				width: 60px;
				height: 3px;
				background: var(--ui-purple-ghost);
				border-radius: 1px;
				overflow: hidden;
			}
			.bar-fill {
				height: 100%;
				border-radius: 1px;
				transition: width 0.3s, background 0.3s;
			}
			.pct {
				font-family: var(--ui-mono);
				font-size: 9px;
				font-variant-numeric: tabular-nums;
			}
		`,
	];

	declare health: number;

	constructor() {
		super();
		this.health = 100;
	}

	static override properties = {
		health: { type: Number },
	};

	override render() {
		const pct = Math.round(this.health);
		const color =
			pct > 60 ? "rgba(163,230,53,0.5)" : pct > 30 ? "rgba(251,191,36,0.5)" : "rgba(244,63,94,0.5)";
		const textColor =
			pct > 60 ? "rgba(163,230,53,0.6)" : pct > 30 ? "rgba(251,191,36,0.7)" : "rgba(244,63,94,0.6)";
		return html`
			<span class="lbl">DMG</span>
			<div class="bar-track">
				<div class="bar-fill" style="width:${pct}%;background:${color}"></div>
			</div>
			<span class="pct" style="color:${textColor}">${pct}%</span>
		`;
	}
}
customElements.define("damage-bar", DamageBar);
