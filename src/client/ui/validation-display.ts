/**
 * ValidationDisplay — color-coded validation status for editor markers.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export interface ValidationIssue {
	type: "error" | "warn" | "ok";
	message: string;
}

export class ValidationDisplay extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: block;
        font-size: 11px;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
      }
      .item.error {
        color: var(--ui-red);
      }
      .item.warn {
        color: var(--ui-orange);
      }
      .item.ok {
        color: var(--ui-green);
      }
      .icon {
        width: 12px;
        text-align: center;
        font-family: var(--ui-mono);
        font-weight: 600;
      }
    `,
	];

	static override properties = {
		issues: { type: Array },
	};

	declare issues: ValidationIssue[];

	constructor() {
		super();
		this.issues = [];
	}

	override render() {
		if (this.issues.length === 0) {
			return html`<div class="item ok">
        <span class="icon">+</span><span>All checks passed</span>
      </div>`;
		}
		return html`
      ${this.issues.map(
				(i) => html`
          <div class="item ${i.type}">
            <span class="icon">${i.type === "error" ? "x" : "!"}</span>
            <span>${i.message}</span>
          </div>
        `,
			)}
    `;
	}
}
customElements.define("validation-display", ValidationDisplay);

declare global {
	interface HTMLElementTagNameMap {
		"validation-display": ValidationDisplay;
	}
}
