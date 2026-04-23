/**
 * MarkerList — displays placed markers with color dots and actions.
 * Supports select (to attach TransformControls), delete, replace, lock/unlock pairs, enable/disable optional.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export interface MarkerEntry {
	id: string;
	type: string;
	position: { x: number; y: number; z: number };
	locked: boolean;
	pairId: string | null;
	enabled: boolean;
}

const TYPE_ORDER = [
	"Wheel_FL",
	"Wheel_FR",
	"Wheel_RL",
	"Wheel_RR",
	"Exhaust_L",
	"Exhaust_R",
	"Headlight_L",
	"Headlight_R",
	"Taillight_L",
	"Taillight_R",
];

const TYPE_COLORS: Record<string, string> = {
	Wheel_FL: "var(--ui-green)",
	Wheel_FR: "var(--ui-green)",
	Wheel_RL: "var(--ui-green-dim)",
	Wheel_RR: "var(--ui-green-dim)",
	Headlight_L: "var(--ui-text-white)",
	Headlight_R: "var(--ui-text-white)",
	Taillight_L: "var(--ui-red)",
	Taillight_R: "var(--ui-red)",
	Exhaust_L: "var(--ui-orange)",
	Exhaust_R: "var(--ui-orange)",
};

const TYPE_LABELS: Record<string, string> = {
	Wheel_FL: "Wheel Front-Left",
	Wheel_FR: "Wheel Front-Right",
	Wheel_RL: "Wheel Rear-Left",
	Wheel_RR: "Wheel Rear-Right",
	Headlight_L: "Headlight Left",
	Headlight_R: "Headlight Right",
	Taillight_L: "Taillight Left",
	Taillight_R: "Taillight Right",
	Exhaust_L: "Exhaust Left",
	Exhaust_R: "Exhaust Right",
};

const OPTIONAL_TYPES = new Set(["Exhaust_R"]);

export class MarkerList extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: block;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 5px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.1s;
        border: 1px solid transparent;
      }
      .item:hover {
        background: var(--ui-accent-ghost);
      }
      .item.selected {
        background: var(--ui-accent-dim);
        border-color: var(--ui-accent);
      }
      .item.disabled {
        opacity: 0.4;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .name {
        flex: 1;
        color: var(--ui-text-bright);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .disabled-label {
        color: var(--ui-text);
        font-size: 9px;
        flex-shrink: 0;
        font-style: italic;
      }
      .pos {
        font-family: var(--ui-mono);
        color: var(--ui-text);
        font-size: 9px;
        flex-shrink: 0;
      }
      .actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.1s;
      }
      .item:hover .actions,
      .item.selected .actions {
        opacity: 1;
      }
      .act {
        padding: 1px 5px;
        border: 1px solid var(--ui-border);
        border-radius: 2px;
        background: transparent;
        color: var(--ui-text);
        cursor: pointer;
        font-size: 10px;
        font-family: var(--ui-mono);
        line-height: 1.3;
      }
      .act:hover {
        background: var(--ui-accent-ghost);
        border-color: var(--ui-accent-dim);
        color: var(--ui-text-bright);
      }
      .act.del {
        color: var(--ui-red);
      }
      .act.del:hover {
        background: var(--ui-red-dim);
        border-color: var(--ui-red);
        color: var(--ui-text-white);
      }
      .act.lock-btn {
        padding: 1px 3px;
        font-size: 12px;
      }
      .act.enable-btn {
        font-size: 9px;
        padding: 1px 3px;
      }
      .empty {
        font-size: 11px;
        color: var(--ui-text);
        padding: 4px 0;
      }
      .add-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 4px 5px;
        border: 1px dashed var(--ui-border);
        border-radius: 3px;
        background: transparent;
        color: var(--ui-accent);
        font-size: 11px;
        font-family: var(--ui-mono);
        cursor: pointer;
        transition: background 0.1s;
        width: 100%;
      }
      .add-btn:hover:not(:disabled) {
        background: var(--ui-accent-ghost);
        border-color: var(--ui-accent-dim);
      }
      .add-btn:disabled {
        opacity: 0.4;
        cursor: default;
        color: var(--ui-text);
      }
    `,
	];

	static override properties = {
		markers: { type: Array },
		selectedId: { type: String },
	};

	declare markers: MarkerEntry[];
	declare selectedId: string;

	constructor() {
		super();
		this.markers = [];
		this.selectedId = "";
	}

	/** Programmatically select a marker by id. */
	selectById(id: string): void {
		this.selectedId = id;
	}

	override render() {
		const sorted = [...this.markers].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

		const placedTypes = new Set(sorted.filter((m) => m.enabled).map((m) => m.type));
		const allPlaced = TYPE_ORDER.every((t) => placedTypes.has(t));
		const nextUnplaced = TYPE_ORDER.find((t) => !placedTypes.has(t)) ?? null;

		return html`
      <div class="list">
        ${
					sorted.length === 0 && nextUnplaced === null
						? html`<div class="empty">No markers placed</div>`
						: sorted.map(
								(m) => html`
                <div
                  class="item${this.selectedId === m.id ? " selected" : ""}${!m.enabled ? " disabled" : ""}"
                  data-id="${m.id}"
                  @click=${this._onSelect}
                >
                  <span
                    class="dot"
                    style="background:${TYPE_COLORS[m.type] ?? "var(--ui-orange)"}"
                  ></span>
                  <span class="name" title="${TYPE_LABELS[m.type] ?? m.type}"
                    >${TYPE_LABELS[m.type] ?? m.type}</span
                  >
                  ${
										!m.enabled
											? html`<span class="disabled-label">disabled</span>`
											: html`<span class="pos">${m.position.y.toFixed(2)}</span>`
									}
                  <span class="actions">
                    ${
											m.pairId
												? html`<button
                          class="act lock-btn"
                          data-id="${m.id}"
                          @click=${this._onLock}
                          title="Toggle lock"
                        >
                          ${m.locked ? "🔒" : "🔓"}
                        </button>`
												: ""
										}
                    ${
											OPTIONAL_TYPES.has(m.type)
												? html`<button
                          class="act enable-btn"
                          data-id="${m.id}"
                          @click=${this._onEnable}
                          title="Toggle enable"
                        >
                          ${m.enabled ? "on" : "off"}
                        </button>`
												: ""
										}
                    <button
                      class="act"
                      data-id="${m.id}"
                      @click=${this._onMove}
                      title="Move (W)"
                    >
                      move
                    </button>
                    <button
                      class="act"
                      data-id="${m.id}"
                      data-type="${m.type}"
                      @click=${this._onPlace}
                      title="Re-place (R)"
                    >
                      re
                    </button>
                    <button
                      class="act del"
                      data-id="${m.id}"
                      @click=${this._onDelete}
                      title="Delete (Del)"
                    >
                      x
                    </button>
                  </span>
                </div>
              `,
							)
				}
        <button class="add-btn" ?disabled=${allPlaced} @click=${this._onAdd}>
          ${allPlaced ? "All placed" : nextUnplaced ? `+ ${TYPE_LABELS[nextUnplaced] ?? nextUnplaced}` : "+ Add marker"}
        </button>
      </div>
    `;
	}

	private _onSelect(e: Event) {
		const id = (e.currentTarget as HTMLElement).dataset.id ?? "";
		this.selectedId = id;
		this.dispatchEvent(
			new CustomEvent("marker-select", {
				detail: id,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onMove(e: Event) {
		e.stopPropagation();
		const id = (e.target as HTMLElement).dataset.id ?? "";
		this.selectedId = id;
		this.dispatchEvent(
			new CustomEvent("marker-move", {
				detail: id,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onPlace(e: Event) {
		e.stopPropagation();
		const btn = e.target as HTMLElement;
		this.dispatchEvent(
			new CustomEvent("marker-replace", {
				detail: { id: btn.dataset.id, type: btn.dataset.type },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onDelete(e: Event) {
		e.stopPropagation();
		const id = (e.target as HTMLElement).dataset.id ?? "";
		if (this.selectedId === id) this.selectedId = "";
		this.dispatchEvent(
			new CustomEvent("marker-delete", {
				detail: id,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onLock(e: Event) {
		e.stopPropagation();
		const id = (e.target as HTMLElement).dataset.id ?? "";
		this.dispatchEvent(
			new CustomEvent("marker-lock", {
				detail: id,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onEnable(e: Event) {
		e.stopPropagation();
		const id = (e.target as HTMLElement).dataset.id ?? "";
		this.dispatchEvent(
			new CustomEvent("marker-enable", {
				detail: id,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onAdd() {
		this.dispatchEvent(
			new CustomEvent("marker-add", {
				detail: null,
				bubbles: true,
				composed: true,
			}),
		);
	}
}
customElements.define("marker-list", MarkerList);

declare global {
	interface HTMLElementTagNameMap {
		"marker-list": MarkerList;
	}
}
