import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

function tempColorClass(temp: number): string {
	if (temp < 75) return "cold";
	if (temp < 88) return "opt";
	if (temp < 100) return "hot";
	return "over";
}

export class TireTemps extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        top: 36px;
        left: 16px;
        z-index: 100;
        pointer-events: none;
        background: var(--ui-panel);
        backdrop-filter: blur(10px);
        border: var(--ui-border);
        padding: 8px 10px;
      }
      .title {
        font-family: var(--ui-mono);
        font-size: 8px;
        color: rgba(92, 158, 255, 0.2);
        letter-spacing: 3px;
        text-align: center;
        margin-bottom: 6px;
      }
      .axle {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-bottom: 4px;
      }
      .tire {
        text-align: center;
      }
      .tire-icon {
        font-size: 9px;
        color: rgba(92, 158, 255, 0.15);
        margin-bottom: 2px;
      }
      .tire-val {
        font-family: var(--ui-mono);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      .tire-val.cold {
        color: rgba(59, 130, 246, 0.6);
      }
      .tire-val.opt {
        color: var(--ui-green);
      }
      .tire-val.hot {
        color: var(--ui-amber);
      }
      .tire-val.over {
        color: var(--ui-red);
      }
    `,
	];

	declare fl: number;
	declare fr: number;
	declare rl: number;
	declare rr: number;

	constructor() {
		super();
		this.fl = 0;
		this.fr = 0;
		this.rl = 0;
		this.rr = 0;
	}

	static override properties = {
		fl: { type: Number },
		fr: { type: Number },
		rl: { type: Number },
		rr: { type: Number },
	};

	private tire(label: string, temp: number) {
		const cls = `tire-val ${tempColorClass(temp)}`;
		return html`
      <div class="tire">
        <div class="tire-icon">${label}</div>
        <div class=${cls}>${Math.round(temp)}</div>
      </div>
    `;
	}

	override render() {
		return html`
      <div class="title">TIRES</div>
      <div class="axle">
        ${this.tire("FL", this.fl)} ${this.tire("FR", this.fr)}
      </div>
      <div class="axle">
        ${this.tire("RL", this.rl)} ${this.tire("RR", this.rr)}
      </div>
    `;
	}
}
customElements.define("tire-temps", TireTemps);

declare global {
	interface HTMLElementTagNameMap {
		"tire-temps": TireTemps;
	}
}
