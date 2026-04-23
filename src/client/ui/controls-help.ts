import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class ControlsHelp extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 100;
        pointer-events: none;
        background: var(--ui-panel);
        backdrop-filter: blur(10px);
        border: var(--ui-border);
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.6;
        color: var(--ui-text);
      }
      .key {
        font-family: var(--ui-mono);
        color: var(--ui-text-bright);
      }
      .link-row {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .back-link {
        display: block;
        padding: 6px 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(92, 158, 255, 0.15);
        border-radius: 4px;
        color: var(--ui-text-bright);
        text-decoration: none;
        font-size: 12px;
        font-family: var(--ui-sans);
        pointer-events: auto;
        transition: background 0.15s;
      }
      .back-link:hover {
        background: rgba(92, 158, 255, 0.1);
      }
    `,
	];

	declare worldUrl: string;
	declare garageUrl: string;

	constructor() {
		super();
		this.worldUrl = "/world";
		this.garageUrl = "/garage";
	}

	static override properties = {
		worldUrl: { type: String },
		garageUrl: { type: String },
	};

	private _navUrl(base: string): string {
		const params = new URLSearchParams(window.location.search);
		const keep = ["seed", "hour", "weather"];
		const filtered = new URLSearchParams();
		for (const key of keep) {
			const val = params.get(key);
			if (val !== null) filtered.set(key, val);
		}
		const qs = filtered.toString();
		return qs ? `${base}?${qs}` : base;
	}

	override render() {
		return html`
      <span class="key">W/S</span> Up/Down - Throttle/Brake<br />
      <span class="key">A/D</span> Left/Right - Steer<br />
      <span class="key">Space</span> - Handbrake<br />
      <span class="key">R</span> - Reset position
      <div class="link-row">
        <a class="back-link" href=${this._navUrl(this.garageUrl)}>Garage</a>
        <a class="back-link" href=${this._navUrl(this.worldUrl)}
          >Back to World</a
        >
      </div>
    `;
	}
}

customElements.define("controls-help", ControlsHelp);

declare global {
	interface HTMLElementTagNameMap {
		"controls-help": ControlsHelp;
	}
}
