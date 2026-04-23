/**
 * EditorPanel — collapsible sidebar section with title.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class EditorPanel extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: block;
        border-bottom: 1px solid var(--ui-border);
      }
      .header {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
      }
      .header:hover {
        background: var(--ui-accent-ghost);
      }
      .title {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--ui-accent-dim);
        font-weight: 600;
        flex: 1;
      }
      .chevron {
        font-size: 9px;
        color: var(--ui-text-bright);
        transition: transform 0.15s;
      }
      :host([collapsed]) .chevron {
        transform: rotate(-90deg);
      }
      .body {
        padding: 0 14px 10px;
        overflow: hidden;
      }
      :host([collapsed]) .body {
        display: none;
      }
    `,
	];

	static override properties = {
		title: { type: String },
		collapsed: { type: Boolean, reflect: true },
	};

	declare title: string;
	declare collapsed: boolean;

	constructor() {
		super();
		this.title = "";
		this.collapsed = false;
	}

	override render() {
		return html`
      <div class="header" @click=${() => (this.collapsed = !this.collapsed)}>
        <span class="title">${this.title}</span>
        <span class="chevron">▾</span>
      </div>
      <div class="body"><slot></slot></div>
    `;
	}
}
customElements.define("editor-panel", EditorPanel);

declare global {
	interface HTMLElementTagNameMap {
		"editor-panel": EditorPanel;
	}
}
