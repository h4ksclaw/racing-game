import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class RpmBar extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				gap: 8px;
				position: fixed;
				bottom: 46px;
				right: 16px;
				z-index: 100;
				pointer-events: none;
				font-family: var(--ui-sans);
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 7px 14px;
			}
			.lbl {
				font-size: 9px;
				color: rgba(139,92,246,0.3);
				font-weight: 600;
				letter-spacing: 2px;
			}
			.segments {
				display: flex;
				gap: 2px;
				flex: 1;
				height: 7px;
			}
			.seg {
				flex: 1;
				background: var(--ui-purple-ghost);
				transition: background 0.05s;
			}
			.seg.filled {
				background: rgba(139,92,246,0.5);
			}
			.seg.filled.red {
				background: rgba(244,63,94,0.6);
			}
			.seg.red-zone {
				background: var(--ui-red-dim);
			}
			.rpm-val {
				font-size: 10px;
				color: rgba(139,92,246,0.5);
				min-width: 28px;
				text-align: right;
				font-family: var(--ui-mono);
				font-variant-numeric: tabular-nums;
			}
		`,
	];

	declare rpm: number;
	declare segments: number;

	constructor() {
		super();
		this.rpm = 0;
		this.segments = 8;
	}

	static override properties = {
		rpm: { type: Number },
		segments: { type: Number },
	};

	override render() {
		const filledCount = Math.round(this.rpm * this.segments);
		const redStart = this.segments - 2;
		const segs: unknown[] = [];
		for (let i = 0; i < this.segments; i++) {
			const isRedZone = i >= redStart;
			const isFilled = i < filledCount;
			const cls = isFilled
				? `seg filled${isRedZone ? " red" : ""}`
				: `seg${isRedZone ? " red-zone" : ""}`;
			segs.push(html`<div class=${cls}></div>`);
		}
		const rpmVal = Math.round(this.rpm * 8000);
		return html`
			<span class="lbl">RPM</span>
			<div class="segments">${segs}</div>
			<span class="rpm-val">${rpmVal}</span>
		`;
	}
}
customElements.define("rpm-bar", RpmBar);
