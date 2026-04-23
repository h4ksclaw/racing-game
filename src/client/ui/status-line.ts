/**
 * StatusLine — fixed bottom status bar for the editor.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class StatusLine extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 100;
        pointer-events: none;
        font-family: var(--ui-mono);
        font-size: 10px;
        color: var(--ui-accent-dim);
        background: var(--ui-panel-solid);
        border-top: 1px solid var(--ui-accent-faint);
        padding: 5px 16px;
        letter-spacing: 0.5px;
      }
    `,
	];

	static override properties = {
		message: { type: String },
	};

	declare message: string;

	constructor() {
		super();
		this.message = "";
	}

	override render() {
		return html`<span>${this.message}</span>`;
	}
}
customElements.define("status-line", StatusLine);

declare global {
	interface HTMLElementTagNameMap {
		"status-line": StatusLine;
	}
}
