/**
 * EditorToolbar — mode buttons, toggles, and view presets for the editor.
 * Uses inline SVG icons with title tooltips.
 */
import { css, html, LitElement } from "lit";
import { icons, svgIcon } from "./icons.ts";
import { themeStyles } from "./theme.ts";

interface ToolDef {
	mode?: string;
	view?: string;
	label: string;
	paths: string[];
}

const MODES: ToolDef[] = [
	{ mode: "orbit", label: "Orbit (Q)", paths: icons.orbit },
	{ mode: "select", label: "Select (Shift+Q)", paths: icons.select },
	{ mode: "place", label: "Place Marker (R)", paths: icons.place },
	{ mode: "assign", label: "Assign (A)", paths: icons.tag },
	{ mode: "move", label: "Move (W)", paths: icons.move },
	{ mode: "delete", label: "Delete (Del)", paths: icons.delete },
];

const VIEWS: ToolDef[] = [
	{ view: "front", label: "Front (1)", paths: icons.front },
	{ view: "back", label: "Back (2)", paths: icons.back },
	{ view: "top", label: "Top (3)", paths: icons.top },
	{ view: "left", label: "Left (4)", paths: icons.left },
	{ view: "right", label: "Right (5)", paths: icons.right },
	{ view: "fit", label: "Fit (0)", paths: icons.fit },
];

export class EditorToolbar extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        position: fixed;
        top: 10px;
        left: 294px;
        z-index: 100;
        display: flex;
        gap: 2px;
        font-family: var(--ui-sans);
      }
      .btn {
        width: 28px;
        height: 28px;
        padding: 0;
        background: var(--ui-panel);
        border: 1px solid var(--ui-border);
        border-radius: 3px;
        color: var(--ui-text-bright);
        cursor: pointer;
        font-size: 10px;
        font-family: var(--ui-sans);
        transition: all 0.12s;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }
      .btn:hover {
        background: var(--ui-accent-ghost);
        border-color: var(--ui-accent-dim);
      }
      .btn.active {
        background: var(--ui-accent-dim);
        border-color: var(--ui-accent);
        color: var(--ui-text-white);
      }
      @keyframes smart-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(168, 130, 255, 0);
          border-color: var(--ui-border);
        }
        50% {
          box-shadow: 0 0 8px 2px rgba(168, 130, 255, 0.4);
          border-color: rgba(168, 130, 255, 0.6);
        }
      }
      .btn.smart-pulse {
        animation: smart-pulse 1.2s ease-in-out 4;
      }
      .btn svg {
        display: block;
      }
      .assign-label {
        font-size: 10px;
        color: var(--ui-accent);
        background: var(--ui-accent-ghost);
        padding: 2px 8px;
        border-radius: 3px;
        border: 1px solid var(--ui-accent-dim);
        white-space: nowrap;
        line-height: 24px;
      }
      .sep {
        width: 1px;
        height: 24px;
        background: var(--ui-accent-ghost);
        margin: 2px 3px;
        align-self: center;
      }
    `,
	];

	static override properties = {
		mode: { type: String },
		assignType: { type: String },
		pendingPlaceType: { type: String },
		wireframe: { type: Boolean },
		dimensions: { type: Boolean },
		exploded: { type: Boolean },
		highlights: { type: Boolean },
	};

	declare mode: string;
	declare assignType: string;
	declare pendingPlaceType: string;
	declare wireframe: boolean;
	declare dimensions: boolean;
	declare exploded: boolean;
	declare highlights: boolean;

	constructor() {
		super();
		this.mode = "select";
		this.wireframe = false;
		this.dimensions = false;
		this.exploded = false;
		this.highlights = true;
	}

	override render() {
		return html`
      ${MODES.map(
				({ mode, label, paths }) => html`
          <button
            class="btn${this.mode === mode ? " active" : ""}"
            data-mode=${mode}
            @click=${this._onMode}
            title="${label}"
          >
            ${svgIcon(paths)}
          </button>
        `,
			)}
      <span class="sep"></span>
      <button
        class="btn${this.wireframe ? " active" : ""}"
        @click=${this._onToggle}
        data-toggle="wireframe"
        title="Toggle Wireframe (X)"
      >
        ${svgIcon(icons.box)}
      </button>
      <button
        class="btn${this.dimensions ? " active" : ""}"
        @click=${this._onToggle}
        data-toggle="dimensions"
        title="Toggle Dimensions (Z)"
      >
        ${svgIcon(icons.ruler)}
      </button>
      <button
        class="btn${this.highlights ? " active" : ""}"
        @click=${this._onToggle}
        data-toggle="highlights"
        title="Toggle Highlights (H)"
      >
        ${svgIcon(icons.highlights)}
      </button>
      <button class="btn" @click=${this._onDownload} title="Download GLB">
        ${svgIcon(icons.download)}
      </button>
      <button
        class="btn"
        data-action="auto-detect"
        @click=${this._onAutoDetect}
        title="Auto-detect (Shift+A)"
      >
        ${svgIcon(icons.brain, 15)}
      </button>
      <button
        class="btn${this.exploded ? " active" : ""}"
        @click=${this._onExplode}
        title="Explode/Reassemble (E)"
      >
        ${svgIcon(icons.explode, 16)}
      </button>
      ${this.mode === "assign" ? html`<span class="assign-label">Assign: ${this.assignType}</span>` : ""}
      ${
				this.mode === "place" && this.pendingPlaceType
					? html`<span class="assign-label"
            >Place: ${this.pendingPlaceType}</span
          >`
					: ""
			}
      <span class="sep"></span>
      ${VIEWS.map(
				({ view, label, paths }) => html`
          <button
            class="btn"
            data-view=${view}
            @click=${this._onView}
            title="${label}"
          >
            ${svgIcon(paths)}
          </button>
        `,
			)}
    `;
	}

	private _onMode(e: Event) {
		const mode = (e.currentTarget as HTMLElement).dataset.mode ?? "";
		if (mode === "assign") {
			const ce = e as MouseEvent;
			this.dispatchEvent(
				new CustomEvent("assign-open", {
					detail: { x: ce.clientX, y: ce.clientY },
					bubbles: true,
					composed: true,
				}),
			);
			return;
		}
		this.dispatchEvent(
			new CustomEvent("mode-change", {
				detail: mode,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onToggle(e: Event) {
		const toggle = (e.currentTarget as HTMLElement).dataset.toggle ?? "";
		this.dispatchEvent(
			new CustomEvent("toggle", {
				detail: toggle,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onAutoDetect() {
		this.dispatchEvent(new CustomEvent("auto-detect", { bubbles: true, composed: true }));
	}

	private _onExplode() {
		this.exploded = !this.exploded;
		this.dispatchEvent(
			new CustomEvent("explode", {
				detail: this.exploded,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onView(e: Event) {
		const view = (e.currentTarget as HTMLElement).dataset.view ?? "";
		this.dispatchEvent(
			new CustomEvent("view-change", {
				detail: view,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onDownload() {
		this.dispatchEvent(new CustomEvent("download-glb", { bubbles: true, composed: true }));
	}
}
customElements.define("editor-toolbar", EditorToolbar);

declare global {
	interface HTMLElementTagNameMap {
		"editor-toolbar": EditorToolbar;
	}
}
