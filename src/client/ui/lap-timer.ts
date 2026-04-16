import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class LapTimer extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				gap: 12px;
				position: fixed;
				top: 36px;
				left: 50%;
				transform: translateX(-50%);
				z-index: 100;
				pointer-events: none;
				font-family: var(--ui-mono);
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 6px 16px;
			}
			.t-lbl {
				font-size: 9px;
				color: rgba(92,158,255,0.3);
				letter-spacing: 2px;
			}
			.t-val {
				font-size: 12px;
				color: var(--ui-text-bright);
				font-variant-numeric: tabular-nums;
			}
			.t-val.best {
				color: var(--ui-green);
			}
			.t-val.delta-neg {
				color: var(--ui-green);
			}
			.t-val.delta-pos {
				color: var(--ui-red);
			}
			.t-sep {
				color: var(--ui-accent-ghost);
			}
		`,
	];

	declare lap: string;
	declare time: string;
	declare best: string;
	declare delta: string;

	constructor() {
		super();
		this.lap = "";
		this.time = "";
		this.best = "";
		this.delta = "";
	}

	static override properties = {
		lap: { type: String },
		time: { type: String },
		best: { type: String },
		delta: { type: String },
	};

	override render() {
		const deltaNum = Number.parseFloat(this.delta);
		const deltaClass = this.delta
			? deltaNum < 0
				? "t-val delta-neg"
				: "t-val delta-pos"
			: "t-val";
		const deltaText = this.delta ? `${deltaNum < 0 ? "" : "+"}${this.delta}` : "";
		return html`
			<span class="t-lbl">LAP</span>
			<span class="t-val">${this.lap}</span>
			<span class="t-sep">|</span>
			<span class="t-lbl">TIME</span>
			<span class="t-val">${this.time}</span>
			<span class="t-sep">|</span>
			<span class="t-lbl">BEST</span>
			<span class="t-val best">${this.best}</span>
			<span class="t-sep">|</span>
			<span class="t-lbl">DELTA</span>
			<span class=${deltaClass}>${deltaText}</span>
		`;
	}
}
customElements.define("lap-timer", LapTimer);
