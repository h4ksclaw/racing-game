import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class LoadingScreen extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				position: fixed;
				inset: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				background: rgba(10,8,18,1);
				z-index: 1000;
				pointer-events: none;
				font-family: var(--ui-sans);
				font-size: 18px;
				color: rgba(255,255,255,0.5);
				transition: opacity 0.3s;
			}
			:host([hidden]) {
				opacity: 0;
				display: none;
			}
		`,
	];

	declare message: string;
	declare visible: boolean;

	constructor() {
		super();
		this.message = "Loading...";
		this.visible = false;
	}

	static override properties = {
		message: { type: String },
		visible: { type: Boolean },
	};

	override render() {
		if (!this.visible) return html``;
		return html`<span>${this.message}</span>`;
	}
}
customElements.define("loading-screen", LoadingScreen);
