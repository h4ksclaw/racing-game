import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class GearStrip extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				position: fixed;
				top: 176px;
				right: 16px;
				z-index: 100;
				pointer-events: none;
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 8px 10px;
			}
			.gear-list {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 2px;
			}
			.g-item {
				width: 32px;
				height: 20px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-family: var(--ui-mono);
				font-size: 10px;
				font-weight: 600;
				color: rgba(92,158,255,0.15);
				border-radius: 2px;
				transition: all 0.15s;
			}
			.g-item.active {
				color: var(--ui-accent);
				background: rgba(92,158,255,0.1);
				text-shadow: 0 0 8px rgba(92,158,255,0.4);
			}
			.g-item.rev { color: rgba(244,63,94,0.3); }
			.g-item.rev.active {
				color: var(--ui-red);
				background: rgba(244,63,94,0.1);
			}
			.g-item.neutral { color: rgba(92,158,255,0.1); font-size: 8px; }
			.g-item.neutral.active { color: rgba(92,158,255,0.4); }
		`,
	];

	declare gear: number;

	constructor() {
		super();
		this.gear = 0;
	}

	static override properties = {
		gear: { type: Number },
	};

	override render() {
		const gears = [
			{ label: "R", value: -1, cls: "rev" },
			{ label: "N", value: 0, cls: "neutral" },
			{ label: "1", value: 1, cls: "" },
			{ label: "2", value: 2, cls: "" },
			{ label: "3", value: 3, cls: "" },
			{ label: "4", value: 4, cls: "" },
			{ label: "5", value: 5, cls: "" },
		];
		return html`
			<div class="gear-list">
				${gears.map(
					(g) => html`
						<div class="g-item ${g.cls}${this.gear === g.value ? " active" : ""}">
							${g.label}
						</div>
					`,
				)}
			</div>
		`;
	}
}
customElements.define("gear-strip", GearStrip);
