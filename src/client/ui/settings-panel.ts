import { css, html, LitElement } from "lit";

export class SettingsPanel extends LitElement {
	static styles = css`
		:host {
			position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 200;
			font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
			--panel-bg: rgba(14,16,24,0.92); --panel-border: rgba(255,255,255,0.1);
			--panel-radius: 16px; --text-primary: #f0f2f5; --text-dim: rgba(240,242,245,0.55);
			--accent: #00e5a0; --input-bg: rgba(255,255,255,0.06); --input-border: rgba(255,255,255,0.1);
		}
		:host([hidden]) { display: none; }
		.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: -1; }
		.panel {
			background: var(--panel-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
			border: 1px solid var(--panel-border); border-radius: var(--panel-radius);
			padding: 28px; width: 340px; max-width: 90vw; max-height: 80vh; overflow-y: auto; color: var(--text-primary);
		}
		.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
		.title { font-size: 18px; font-weight: 600; }
		.close-btn {
			width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--input-border);
			background: var(--input-bg); color: var(--text-dim); cursor: pointer; font-size: 16px;
			display: flex; align-items: center; justify-content: center; transition: all 0.15s;
		}
		.close-btn:hover { background: rgba(255,51,85,0.15); border-color: rgba(255,51,85,0.3); color: #ff3355; }
		.section { margin-bottom: 18px; }
		.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-dim); margin-bottom: 10px; }
		.setting-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
		.setting-label { font-size: 13px; }
		input[type="range"] { -webkit-appearance: none; width: 120px; height: 4px; background: var(--input-bg); border-radius: 2px; outline: none; }
		input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); cursor: pointer; }
		.toggle {
			width: 40px; height: 22px; border-radius: 11px; background: var(--input-bg);
			border: 1px solid var(--input-border); cursor: pointer; position: relative; transition: all 0.2s;
		}
		.toggle.on { background: rgba(0,229,160,0.25); border-color: rgba(0,229,160,0.4); }
		.toggle::after {
			content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
			border-radius: 50%; background: var(--text-dim); transition: all 0.2s;
		}
		.toggle.on::after { left: 20px; background: var(--accent); }
		.btn {
			display: block; width: 100%; padding: 10px; margin-top: 16px; border-radius: 8px;
			background: rgba(0,229,160,0.12); border: 1px solid rgba(0,229,160,0.25);
			color: var(--accent); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s;
		}
		.btn:hover { background: rgba(0,229,160,0.22); }
	`;

	static properties = {
		hidden: { type: Boolean, reflect: true },
		fov: { type: Number },
		volume: { type: Number },
		shadows: { type: Boolean },
		bloom: { type: Boolean },
	};

	declare hidden: boolean;
	declare fov: number;
	declare volume: number;
	declare shadows: boolean;
	declare bloom: boolean;

	constructor() {
		super();
		this.hidden = true;
		this.fov = 75;
		this.volume = 80;
		this.shadows = true;
		this.bloom = true;
	}

	render() {
		return html`
			<div class="overlay" @click=${this._close}></div>
			<div class="panel">
				<div class="header">
					<div class="title">Settings</div>
					<button class="close-btn" @click=${this._close}>X</button>
				</div>
				<div class="section">
					<div class="section-title">Graphics</div>
					<div class="setting-row"><span class="setting-label">FOV</span>
						<input type="range" min="60" max="110" .value=${String(this.fov)} @input=${(
							e: Event,
						) => {
							this.fov = Number((e.target as HTMLInputElement).value);
						}} /></div>
					<div class="setting-row"><span class="setting-label">Shadows</span>
						<div class="toggle ${this.shadows ? "on" : ""}" @click=${() => {
							this.shadows = !this.shadows;
						}}></div></div>
					<div class="setting-row"><span class="setting-label">Bloom</span>
						<div class="toggle ${this.bloom ? "on" : ""}" @click=${() => {
							this.bloom = !this.bloom;
						}}></div></div>
				</div>
				<div class="section">
					<div class="section-title">Audio</div>
					<div class="setting-row"><span class="setting-label">Volume</span>
						<input type="range" min="0" max="100" .value=${String(this.volume)} @input=${(
							e: Event,
						) => {
							this.volume = Number((e.target as HTMLInputElement).value);
						}} /></div>
				</div>
				<button class="btn" @click=${this._close}>Apply & Close</button>
			</div>
		`;
	}

	private _close() {
		this.hidden = true;
		this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
	}
}

customElements.define("settings-panel", SettingsPanel);
