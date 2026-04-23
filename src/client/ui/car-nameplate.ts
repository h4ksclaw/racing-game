import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class CarNameplate extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: flex;
        align-items: stretch;
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 100;
        pointer-events: none;
        font-family: var(--ui-sans);
      }
      .num {
        background: rgba(92, 158, 255, 0.85);
        padding: 5px 12px;
        display: flex;
        align-items: center;
      }
      .num span {
        font-size: 15px;
        font-weight: 800;
        color: #fff;
        letter-spacing: 1px;
        font-family: var(--ui-mono);
      }
      .car {
        padding: 5px 14px;
        display: flex;
        align-items: center;
        border: 1px solid var(--ui-accent-faint);
        border-left: none;
        background: var(--ui-panel);
      }
      .car span {
        font-size: 12px;
        font-weight: 600;
        color: var(--ui-text-bright);
        letter-spacing: 0.5px;
      }
    `,
	];

	declare number: string;
	declare name: string;

	constructor() {
		super();
		this.number = "";
		this.name = "";
	}

	static override properties = {
		number: { type: String },
		name: { type: String },
	};

	override render() {
		return html`
      <div class="num"><span>${this.number}</span></div>
      <div class="car"><span>${this.name}</span></div>
    `;
	}
}
customElements.define("car-nameplate", CarNameplate);

declare global {
	interface HTMLElementTagNameMap {
		"car-nameplate": CarNameplate;
	}
}
