import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SystemBar extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				position: fixed;
				top: 0;
				left: 0;
				right: 0;
				z-index: 100;
				pointer-events: none;
				font-family: var(--ui-mono);
				background: var(--ui-panel-solid);
				backdrop-filter: blur(12px);
				border-bottom: 1px solid var(--ui-accent-faint);
				padding: 7px 20px;
			}
			.lbl {
				font-size: 9px;
				color: var(--ui-accent-dim);
				letter-spacing: 3px;
			}
			.val {
				font-size: 9px;
				color: var(--ui-text);
				margin-left: 6px;
				font-variant-numeric: tabular-nums;
			}
			.sep {
				font-size: 9px;
				color: var(--ui-accent-ghost);
				margin: 0 14px;
			}
			.controls {
				margin-left: auto;
				font-size: 9px;
				color: rgba(92,158,255,0.15);
				letter-spacing: 1px;
			}
		`,
	];

	declare seed: number;
	declare time: string;
	declare weather: string;
	declare surface: string;
	declare posX: number;
	declare posZ: number;
	declare posY: number;

	constructor() {
		super();
		this.seed = 0;
		this.time = "";
		this.weather = "";
		this.surface = "";
		this.posX = 0;
		this.posZ = 0;
		this.posY = 0;
	}

	static override properties = {
		seed: { type: Number },
		time: { type: String },
		weather: { type: String },
		surface: { type: String },
		posX: { type: Number },
		posZ: { type: Number },
		posY: { type: Number },
	};

	override render() {
		const pos = `${this.posX.toFixed(1)} / ${this.posZ.toFixed(1)} / ${this.posY.toFixed(1)}`;
		return html`
			<span class="lbl">SEED</span><span class="val">${String(this.seed).padStart(4, "0")}</span>
			<span class="sep">|</span>
			<span class="lbl">TIME</span><span class="val">${this.time}</span>
			<span class="sep">|</span>
			<span class="lbl">WX</span><span class="val">${this.weather.toUpperCase()}</span>
			<span class="sep">|</span>
			<span class="lbl">SURFACE</span><span class="val">${this.surface.toUpperCase()}</span>
			<span class="sep">|</span>
			<span class="lbl">POS</span><span class="val">${pos}</span>
			<span class="controls">W/S A/D SPACE R</span>
		`;
	}
}
customElements.define("system-bar", SystemBar);
