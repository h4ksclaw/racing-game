import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SteerIndicator extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        bottom: 110px;
        left: 16px;
        z-index: 100;
        pointer-events: none;
        background: var(--ui-panel);
        backdrop-filter: blur(10px);
        border: var(--ui-border);
        padding: 8px 12px;
        width: 44px;
      }
      .bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .track {
        width: 4px;
        height: 60px;
        background: var(--ui-accent-ghost);
        border-radius: 2px;
        position: relative;
      }
      .needle {
        position: absolute;
        left: -4px;
        width: 12px;
        height: 3px;
        background: var(--ui-accent);
        border-radius: 1px;
        box-shadow: 0 0 8px rgba(92, 158, 255, 0.4);
        transition: top 0.1s;
      }
      .labels {
        font-family: var(--ui-mono);
        font-size: 8px;
        color: rgba(92, 158, 255, 0.2);
        letter-spacing: 2px;
        text-align: center;
      }
    `,
	];

	declare input: number;

	constructor() {
		super();
		this.input = 0;
	}

	static override properties = {
		input: { type: Number },
	};

	override render() {
		const pct = 50 - this.input * 40;
		const clamped = Math.max(5, Math.min(95, pct));
		return html`
      <div class="bar">
        <div class="labels">L</div>
        <div class="track">
          <div class="needle" style="top:${clamped}%"></div>
        </div>
        <div class="labels">R</div>
      </div>
    `;
	}
}
customElements.define("steer-indicator", SteerIndicator);

declare global {
	interface HTMLElementTagNameMap {
		"steer-indicator": SteerIndicator;
	}
}
