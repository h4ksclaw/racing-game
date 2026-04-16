import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SpeedDisplay extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: inline-flex;
				align-items: baseline;
				gap: 6px;
				position: fixed;
				bottom: 60px;
				left: 16px;
				z-index: 100;
				pointer-events: none;
				font-family: var(--ui-sans);
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 7px 14px;
			}
			.speed-val {
				font-size: 30px;
				font-weight: 700;
				color: var(--ui-text-white);
				font-variant-numeric: tabular-nums;
				letter-spacing: -1px;
				font-family: var(--ui-mono);
			}
			.speed-unit {
				font-size: 10px;
				color: var(--ui-purple-dim);
				font-weight: 500;
				letter-spacing: 1px;
			}
			.sep {
				margin: 0 6px;
				color: var(--ui-purple-faint);
			}
			.lbl {
				font-size: 9px;
				color: rgba(139,92,246,0.3);
				font-weight: 600;
				letter-spacing: 1px;
			}
			.val {
				font-size: 17px;
				font-weight: 700;
				color: var(--ui-purple-dim);
				font-variant-numeric: tabular-nums;
				font-family: var(--ui-mono);
			}
			.val-w {
				font-size: 17px;
				font-weight: 700;
				color: var(--ui-text-bright);
				font-variant-numeric: tabular-nums;
				font-family: var(--ui-mono);
			}
		`,
	];

	declare speed: number;
	declare gear: number;
	declare rpm: number;

	constructor() {
		super();
		this.speed = 0;
		this.gear = 0;
		this.rpm = 0;
	}

	static override properties = {
		speed: { type: Number },
		gear: { type: Number },
		rpm: { type: Number },
	};

	override render() {
		const absSpeed = Math.abs(Math.round(this.speed));
		const gearLabel = this.gear === -1 ? "R" : this.gear === 0 ? "N" : String(this.gear);
		const rpmVal = Math.round(this.rpm * 8000);
		return html`
			<span class="speed-val">${absSpeed}</span>
			<span class="speed-unit">km/h</span>
			<span class="sep">|</span>
			<span class="lbl">GEAR</span>
			<span class="val">${gearLabel}</span>
			<span class="sep">|</span>
			<span class="lbl">RPM</span>
			<span class="val-w">${rpmVal}</span>
		`;
	}
}
customElements.define("speed-display", SpeedDisplay);
