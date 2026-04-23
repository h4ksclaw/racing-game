/**
 * Physics Overrides Panel — reusable modal for editing chassis physics parameters.
 * Can be used in the editor, garage, or practice mode.
 *
 * Usage:
 *   <physics-modal id="physics-modal"></physics-modal>
 *   document.getElementById("physics-modal").open();
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "../ui/theme.ts";
import type { PhysicsOverrides } from "./bake-export.js";
import {
	getDefaultOverrides,
	getPhysicsOverrides,
	onOverridesChange,
	resetToCarDefaults,
	setPhysicsOverrides,
} from "./physics-editor.js";

interface ParamDef {
	key: keyof PhysicsOverrides;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
	unit: string;
}

const PARAMS: ParamDef[] = [
	{
		key: "mass",
		label: "Mass",
		min: 500,
		max: 3000,
		step: 10,
		default: 1200,
		unit: "kg",
	},
	{
		key: "suspensionStiffness",
		label: "Susp. Stiffness",
		min: 5,
		max: 200,
		step: 1,
		default: 50,
		unit: "",
	},
	{
		key: "suspensionRestLength",
		label: "Susp. Rest Length",
		min: 0.05,
		max: 0.8,
		step: 0.01,
		default: 0.3,
		unit: "m",
	},
	{
		key: "maxSuspensionTravel",
		label: "Max Susp. Travel",
		min: 0.05,
		max: 0.5,
		step: 0.01,
		default: 0.3,
		unit: "m",
	},
	{
		key: "dampingRelaxation",
		label: "Damping Relaxation",
		min: 0.1,
		max: 10,
		step: 0.1,
		default: 2.3,
		unit: "",
	},
	{
		key: "dampingCompression",
		label: "Damping Compression",
		min: 0.1,
		max: 10,
		step: 0.1,
		default: 4.4,
		unit: "",
	},
	{
		key: "rollInfluence",
		label: "Roll Influence",
		min: 0,
		max: 0.3,
		step: 0.005,
		default: 0.1,
		unit: "",
	},
	{
		key: "maxSteerAngle",
		label: "Max Steer Angle",
		min: 0.1,
		max: 1.0,
		step: 0.01,
		default: 0.6,
		unit: "rad",
	},
	{
		key: "cgHeight",
		label: "CG Height",
		min: 0.1,
		max: 1.0,
		step: 0.01,
		default: 0.35,
		unit: "m",
	},
	{
		key: "weightFront",
		label: "Weight Front %",
		min: 0.3,
		max: 0.7,
		step: 0.01,
		default: 0.55,
		unit: "",
	},
	{
		key: "corneringStiffnessFront",
		label: "Corner. Stiff. Front",
		min: 100,
		max: 200000,
		step: 100,
		default: 80000,
		unit: "",
	},
	{
		key: "corneringStiffnessRear",
		label: "Corner. Stiff. Rear",
		min: 100,
		max: 200000,
		step: 100,
		default: 80000,
		unit: "",
	},
	{
		key: "peakFriction" as keyof PhysicsOverrides,
		label: "Peak Friction",
		min: 0.5,
		max: 10,
		step: 0.1,
		default: 3.5,
		unit: "",
	},
];

export class PhysicsModal extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 200;
        background: rgba(0, 0, 0, 0.6);
        font-family: var(--ui-sans);
      }
      :host([open]) {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .modal {
        background: var(--ui-panel);
        border: 1px solid var(--ui-border);
        border-radius: 6px;
        width: 520px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid var(--ui-border);
      }
      .modal-header h3 {
        margin: 0;
        font-size: 13px;
        color: var(--ui-text-bright);
        font-weight: 600;
      }
      .close-btn {
        background: none;
        border: none;
        color: var(--ui-text);
        font-size: 18px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        line-height: 1;
      }
      .close-btn:hover {
        background: var(--ui-accent-ghost);
        color: var(--ui-text-bright);
      }
      .modal-body {
        padding: 12px 14px;
        overflow-y: auto;
        flex: 1;
      }
      .param-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .param-label {
        flex: 0 0 140px;
        font-size: 11px;
        color: var(--ui-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .param-slider {
        flex: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        background: var(--ui-accent-ghost);
        border-radius: 2px;
        outline: none;
      }
      .param-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        background: var(--ui-accent);
        border-radius: 50%;
        cursor: pointer;
      }
      .param-value {
        flex: 0 0 60px;
        text-align: right;
        font-size: 11px;
        color: var(--ui-text-bright);
        font-family: var(--ui-mono);
      }
      .param-unit {
        flex: 0 0 30px;
        font-size: 10px;
        color: var(--ui-text);
        opacity: 0.6;
      }
      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        padding: 8px 14px;
        border-top: 1px solid var(--ui-border);
      }
      .btn {
        padding: 5px 12px;
        border: 1px solid var(--ui-border);
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: var(--ui-sans);
      }
      .btn-reset {
        background: var(--ui-panel);
        color: var(--ui-text);
      }
      .btn-reset:hover {
        background: var(--ui-accent-ghost);
      }
      .btn-apply {
        background: var(--ui-accent-dim);
        border-color: var(--ui-accent);
        color: var(--ui-text-white);
      }
      .btn-apply:hover {
        background: var(--ui-accent);
      }
    `,
	];

	static override properties = {
		open: { type: Boolean, reflect: true },
	};

	declare open: boolean;

	private _overrides: PhysicsOverrides = getDefaultOverrides();

	constructor() {
		super();
		this.open = false;
		// Sync with shared state
		this._overrides = { ...getPhysicsOverrides() };
		onOverridesChange((o) => {
			this._overrides = { ...o };
			this.requestUpdate();
		});
	}

	/** Get current overrides from shared state. */
	getOverrides(): PhysicsOverrides {
		return getPhysicsOverrides();
	}

	/** Set overrides programmatically (delegates to shared state). */
	setOverrides(overrides: PhysicsOverrides): void {
		setPhysicsOverrides(overrides);
	}

	openModal(): void {
		this.open = true;
	}

	closeModal(): void {
		this.open = false;
	}

	override render() {
		return html`
      <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Physics Overrides</h3>
          <button class="close-btn" @click=${this.closeModal} title="Close">
            &times;
          </button>
        </div>
        <div class="modal-body">
          ${PARAMS.map((p) => {
						const val = this._overrides[p.key] ?? p.default;
						return html`
              <div class="param-row">
                <span class="param-label" title="${p.label}">${p.label}</span>
                <input
                  type="range"
                  class="param-slider"
                  min="${p.min}"
                  max="${p.max}"
                  step="${p.step}"
                  .value=${String(val)}
                  @input=${(e: Event) => this._onSlider(p, (e.target as HTMLInputElement).value)}
                />
                <span class="param-value"
                  >${Number(val).toFixed(p.step < 1 ? 2 : 0)}</span
                >
                <span class="param-unit">${p.unit}</span>
              </div>
            `;
					})}
        </div>
        <div class="modal-footer">
          <button class="btn btn-reset" @click=${this._reset}>
            Reset Defaults
          </button>
          <button class="btn btn-apply" @click=${this.closeModal}>Done</button>
        </div>
      </div>
    `;
	}

	private _onSlider(param: ParamDef, value: string): void {
		const num = parseFloat(value);
		if (!isNaN(num)) {
			setPhysicsOverrides({ [param.key]: num });
		}
	}

	private _reset(): void {
		const carDefaults = resetToCarDefaults();
		this._overrides = { ...carDefaults };
	}
}
customElements.define("physics-modal", PhysicsModal);

declare global {
	interface HTMLElementTagNameMap {
		"physics-modal": PhysicsModal;
	}
}
