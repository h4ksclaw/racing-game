import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class LoadingScreen extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				position: fixed;
				inset: 0;
				display: none;
				align-items: center;
				justify-content: center;
				flex-direction: column;
				gap: 20px;
				background: rgba(10, 8, 18, 1);
				z-index: 1000;
				pointer-events: none;
				font-family: var(--ui-sans);
			}
			:host([visible]) {
				display: flex;
			}

			.spinner {
				width: 32px;
				height: 32px;
				border: 2px solid rgba(139, 92, 246, 0.12);
				border-top-color: rgba(139, 92, 246, 0.6);
				border-radius: 50%;
				animation: spin 0.8s linear infinite;
			}

			@keyframes spin {
				to {
					transform: rotate(360deg);
				}
			}

			.msg {
				font-size: 13px;
				font-weight: 500;
				color: rgba(255, 255, 255, 0.35);
				letter-spacing: 2px;
				text-transform: uppercase;
				font-family: var(--ui-mono);
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
		visible: { type: Boolean, reflect: true },
	};

	override render() {
		return html`
			<div class="spinner"></div>
			<span class="msg">${this.message}</span>
		`;
	}
}

customElements.define("loading-screen", LoadingScreen);
