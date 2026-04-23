import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class PedalBars extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        bottom: 200px;
        left: 16px;
        z-index: 100;
        pointer-events: none;
      }
      .bar-group {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        margin-bottom: 6px;
      }
      .bar-label {
        font-family: var(--ui-mono);
        font-size: 8px;
        color: rgba(92, 158, 255, 0.2);
        letter-spacing: 2px;
        width: 28px;
        text-align: right;
        padding-bottom: 4px;
      }
      .bar-track {
        width: 8px;
        height: 40px;
        background: var(--ui-accent-ghost);
        border-radius: 2px;
        position: relative;
        overflow: hidden;
      }
      .bar-fill {
        position: absolute;
        bottom: 0;
        width: 100%;
        border-radius: 2px;
        transition: height 0.08s;
      }
      .thr-fill {
        background: var(--ui-accent);
      }
      .brk-fill {
        background: var(--ui-red);
      }
    `,
	];

	declare throttle: number;
	declare brake: number;

	constructor() {
		super();
		this.throttle = 0;
		this.brake = 0;
	}

	static override properties = {
		throttle: { type: Number },
		brake: { type: Number },
	};

	override render() {
		return html`
      <div class="bar-group">
        <span class="bar-label">THR</span>
        <div class="bar-track">
          <div
            class="bar-fill thr-fill"
            style="height:${this.throttle * 100}%"
          ></div>
        </div>
      </div>
      <div class="bar-group">
        <span class="bar-label">BRK</span>
        <div class="bar-track">
          <div
            class="bar-fill brk-fill"
            style="height:${this.brake * 100}%"
          ></div>
        </div>
      </div>
    `;
	}
}
customElements.define("pedal-bars", PedalBars);

declare global {
	interface HTMLElementTagNameMap {
		"pedal-bars": PedalBars;
	}
}
