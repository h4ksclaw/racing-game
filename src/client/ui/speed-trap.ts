import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SpeedTrap extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: flex;
        align-items: center;
        gap: 8px;
        position: fixed;
        bottom: 72px;
        right: 16px;
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
        color: rgba(92, 158, 255, 0.2);
        letter-spacing: 2px;
      }
      .val {
        font-family: var(--ui-mono);
        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--ui-green);
      }
      .unit {
        font-family: var(--ui-mono);
        font-size: 8px;
        color: rgba(92, 158, 255, 0.2);
      }
    `,
	];

	declare topSpeed: number;

	constructor() {
		super();
		this.topSpeed = 0;
	}

	static override properties = {
		topSpeed: { type: Number },
	};

	override render() {
		return html`
      <span class="lbl">TOP</span>
      <span class="val">${Math.round(this.topSpeed)}</span>
      <span class="unit">km/h</span>
    `;
	}
}
customElements.define("speed-trap", SpeedTrap);

declare global {
	interface HTMLElementTagNameMap {
		"speed-trap": SpeedTrap;
	}
}
