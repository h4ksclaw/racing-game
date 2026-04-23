/**
 * SliderRow — reusable labeled range slider with value display.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SliderRow extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
      }
      label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ui-text-bright);
      }
      input[type="range"] {
        width: 90px;
        -webkit-appearance: none;
        appearance: none;
        height: 3px;
        background: var(--ui-accent-ghost);
        border-radius: 2px;
        outline: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ui-accent);
        cursor: pointer;
      }
      .val {
        width: 56px;
        text-align: right;
        font-family: var(--ui-mono);
        color: var(--ui-text-bright);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      :host([disabled]) {
        opacity: 0.4;
        pointer-events: none;
      }
    `,
	];

	static override properties = {
		label: { type: String },
		value: { type: Number },
		min: { type: Number },
		max: { type: Number },
		step: { type: Number },
		unit: { type: String },
		disabled: { type: Boolean, reflect: true },
	};

	declare label: string;
	declare value: number;
	declare min: number;
	declare max: number;
	declare step: number;
	declare unit: string;
	declare disabled: boolean;

	constructor() {
		super();
		this.label = "";
		this.value = 0;
		this.min = 0;
		this.max = 100;
		this.step = 1;
		this.unit = "";
		this.disabled = false;
	}

	override render() {
		const display = this.unit ? `${this.value} ${this.unit}` : String(this.value);
		return html`
      <label>${this.label}</label>
      <input
        type="range"
        .value=${String(this.value)}
        min=${this.min}
        max=${this.max}
        step=${this.step}
        ?disabled=${this.disabled}
        @input=${this._onInput}
      />
      <span class="val">${display}</span>
    `;
	}

	private _onInput(e: Event) {
		this.value = parseFloat((e.target as HTMLInputElement).value);
		this.dispatchEvent(
			new CustomEvent("slider-input", {
				detail: this.value,
				bubbles: true,
				composed: true,
			}),
		);
	}
}
customElements.define("slider-row", SliderRow);

declare global {
	interface HTMLElementTagNameMap {
		"slider-row": SliderRow;
	}
}
