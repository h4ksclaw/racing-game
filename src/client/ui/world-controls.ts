import { css, html, LitElement } from "lit";

export class WorldControls extends LitElement {
	static styles = css`
		:host {
			position: fixed;
			top: 16px;
			left: 16px;
			z-index: 100;
			font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
			--panel-bg: rgba(10, 12, 18, 0.75);
			--panel-border: rgba(255, 255, 255, 0.08);
			--panel-radius: 12px;
			--text-primary: #f0f2f5;
			--text-dim: rgba(240, 242, 245, 0.55);
			--text-muted: rgba(240, 242, 245, 0.35);
			--accent: #00e5a0;
			--accent-dim: rgba(0, 229, 160, 0.15);
			--warning: #ff6b35;
			--input-bg: rgba(255, 255, 255, 0.06);
			--input-border: rgba(255, 255, 255, 0.1);
		}

		.panel {
			background: var(--panel-bg);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			border: 1px solid var(--panel-border);
			border-radius: var(--panel-radius);
			padding: 20px;
			width: 220px;
			color: var(--text-primary);
		}

		.title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }

		.label {
			display: block; font-size: 11px; color: var(--text-dim);
			text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;
		}

		.seed-row {
			display: flex; align-items: center; justify-content: space-between;
			margin-bottom: 14px;
		}

		.seed-value {
			font-size: 13px;
			font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
			color: var(--accent);
		}

		.field { margin-bottom: 12px; }

		input[type="range"] {
			-webkit-appearance: none; appearance: none;
			width: 100%; height: 4px;
			background: var(--input-bg); border-radius: 2px; outline: none; margin-top: 4px;
		}
		input[type="range"]::-webkit-slider-thumb {
			-webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
			background: var(--accent); cursor: pointer; border: 2px solid rgba(0,0,0,0.3);
		}
		input[type="range"]::-moz-range-thumb {
			width: 14px; height: 14px; border-radius: 50%;
			background: var(--accent); cursor: pointer; border: 2px solid rgba(0,0,0,0.3);
		}

		.range-row { display: flex; justify-content: space-between; align-items: center; }
		.range-value { font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }

		select {
			width: 100%; padding: 6px 10px; background: var(--input-bg);
			border: 1px solid var(--input-border); border-radius: 6px;
			color: var(--text-primary); font-size: 13px; outline: none; margin-top: 4px; cursor: pointer;
		}
		select option { background: #1a1c24; }

		.btn {
			display: block; width: 100%; padding: 9px 14px; border-radius: 8px;
			font-size: 13px; font-weight: 500; cursor: pointer;
			transition: all 0.15s ease; text-align: center; border: 1px solid; margin-bottom: 8px;
		}
		.btn-primary {
			background: var(--accent-dim); border-color: rgba(0,229,160,0.25); color: var(--accent);
		}
		.btn-primary:hover {
			background: rgba(0,229,160,0.25); border-color: rgba(0,229,160,0.4);
		}
		.btn-secondary {
			background: var(--input-bg); border-color: var(--input-border); color: var(--text-dim);
		}
		.btn-secondary:hover {
			background: rgba(255,255,255,0.1); color: var(--text-primary);
		}
		.btn-drive {
			background: rgba(255,107,53,0.12); border-color: rgba(255,107,53,0.25); color: var(--warning);
		}
		.btn-drive:hover {
			background: rgba(255,107,53,0.22); border-color: rgba(255,107,53,0.4);
		}

		@media (max-width: 600px) {
			:host { top: 8px; left: 8px; }
			.panel { width: 180px; padding: 14px; }
			.title { font-size: 13px; }
			.btn { padding: 8px 10px; font-size: 12px; }
		}
	`;

	static properties = {
		seed: { type: Number },
		hour: { type: Number },
		weather: { type: String },
		flyoverActive: { type: Boolean },
	};

	seed = 42;
	hour = 12;
	weather = "clear";
	flyoverActive = false;

	render() {
		const timeStr = this._formatHour(this.hour);
		return html`
			<div class="panel">
				<div class="title">World Generator</div>
				<div class="seed-row">
					<span class="label">Seed</span>
					<span class="seed-value">${this.seed}</span>
				</div>
				<button class="btn btn-primary" @click=${this._onGenerate}>New World</button>
				<button class="btn btn-secondary" @click=${this._onFlyover}>
					${this.flyoverActive ? "⏹ Stop Preview" : "▶ Preview World"}
				</button>
				<div class="field">
					<div class="range-row"><span class="label">Flyover Speed</span><span class="range-value">120 km/h</span></div>
					<input type="range" min="80" max="500" step="10" value="120" @input=${this._onSpeed} />
				</div>
				<div class="field">
					<span class="label">Time of Day</span>
					<div class="range-row"><span class="range-value">${timeStr}</span></div>
					<input type="range" min="0" max="24" step="0.1" .value=${String(this.hour)} @input=${this._onHour} />
				</div>
				<div class="field">
					<span class="label">Weather</span>
					<select .value=${this.weather} @change=${this._onWeather}>
						<option value="clear">Clear</option>
						<option value="cloudy">Cloudy</option>
						<option value="rain">Rain</option>
						<option value="heavy_rain">Heavy Rain</option>
						<option value="fog">Fog</option>
						<option value="snow">Snow</option>
					</select>
				</div>
				<button class="btn btn-drive" @click=${this._onPractice}>🏎️ Drive This World</button>
			</div>
		`;
	}

	private _formatHour(h: number): string {
		const hr = Math.floor(h) % 24;
		const min = Math.floor((h % 1) * 60);
		return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
	}

	private _onGenerate() {
		const newSeed = Math.floor(Math.random() * 100000);
		this.seed = newSeed;
		this.dispatchEvent(
			new CustomEvent("generate", { detail: { seed: newSeed }, bubbles: true, composed: true }),
		);
	}

	private _onFlyover() {
		this.flyoverActive = !this.flyoverActive;
		this.dispatchEvent(
			new CustomEvent("flyover", {
				detail: { active: this.flyoverActive },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onSpeed(e: Event) {
		this.dispatchEvent(
			new CustomEvent("change:speed", {
				detail: { speed: Number((e.target as HTMLInputElement).value) },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onHour(e: Event) {
		this.hour = Number.parseFloat((e.target as HTMLInputElement).value);
		this.dispatchEvent(
			new CustomEvent("change:hour", {
				detail: { hour: this.hour },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onWeather(e: Event) {
		this.weather = (e.target as HTMLSelectElement).value;
		this.dispatchEvent(
			new CustomEvent("change:weather", {
				detail: { weather: this.weather },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onPractice() {
		const params = new URLSearchParams(window.location.search);
		params.set("seed", String(this.seed));
		params.set("hour", String(this.hour));
		params.set("weather", this.weather);
		window.location.href = `/practice?${params.toString()}`;
	}
}

customElements.define("world-controls", WorldControls);
