import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class RaceToast extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				position: fixed;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				z-index: 200;
				pointer-events: none;
				font-family: var(--ui-mono);
				background: var(--ui-panel-solid);
				backdrop-filter: blur(12px);
				border: 1px solid var(--ui-purple-faint);
				padding: 10px 22px;
				font-size: 10px;
				color: rgba(139,92,246,0.5);
				letter-spacing: 2px;
				transition: opacity 0.3s;
			}
			:host([hidden]) {
				opacity: 0;
			}
			.prefix {
				margin-right: 8px;
			}
			.prefix.ok { color: var(--ui-green); }
			.prefix.warn { color: var(--ui-amber); }
			.prefix.error { color: var(--ui-red); }
		`,
	];

	declare message: string;
	declare type: string;
	declare visible: boolean;

	private _timer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		super();
		this.message = "";
		this.type = "ok";
		this.visible = false;
	}

	static override properties = {
		message: { type: String },
		type: { type: String },
		visible: { type: Boolean },
	};

	show(message: string, duration = 2000): void {
		this.message = message;
		this.visible = true;
		if (this._timer) clearTimeout(this._timer);
		this._timer = setTimeout(() => {
			this.visible = false;
			this._timer = undefined;
			this.requestUpdate();
		}, duration);
	}

	override render() {
		if (!this.visible) return html``;
		return html`
			<span class="prefix ${this.type}">[${this.type.toUpperCase()}]</span>
			<span>${this.message}</span>
		`;
	}
}
customElements.define("race-toast", RaceToast);
