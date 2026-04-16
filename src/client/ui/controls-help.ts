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
			.back-link {
				display: inline-block;
				margin-top: 10px;
				padding: 6px 14px;
				background: rgba(255,255,255,0.05);
				border: 1px solid rgba(139,92,246,0.15);
				border-radius: 4px;
				color: var(--ui-text-bright);
				text-decoration: none;
				font-size: 12px;
				font-family: var(--ui-sans);
				pointer-events: auto;
				transition: background 0.15s;
			}
			.back-link:hover {
				background: rgba(139,92,246,0.1);
			}
		`,
	];

	declare worldUrl: string;

	constructor() {
		super();
		this.worldUrl = "/world";
	}

	static override properties = {
		worldUrl: { type: String },
	};

	override render() {
		return html`
			<span class="key">W/S</span> or Up/Down -- Throttle/Brake<br>
			<span class="key">A/D</span> or Left/Right -- Steer<br>
			<span class="key">Space</span> -- Handbrake<br>
			<span class="key">R</span> -- Reset position<br>
			<a class="back-link" href=${this.worldUrl}>Back to World</a>
		`;
	}
}
customElements.define("controls-help", ControlsHelp);
