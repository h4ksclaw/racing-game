/**
 * CarSearch — proper car database search with loading state, scrollable dropdown,
 * and selection that doesn't auto-load the model.
 */
import { css, html, LitElement, type TemplateResult } from "lit";
import { themeStyles } from "./theme.ts";

interface CarResult {
	id: number;
	make: string;
	model: string;
	year: number | null;
	trim: string | null;
	bodyType: string | null;
	weightKg: number | null;
	weightFrontPct: number | null;
	drivetrain: string | null;
	dimensions: {
		length_m: number | null;
		width_m: number | null;
		height_m: number | null;
		wheelbase_m?: number | null;
		[key: string]: unknown;
	} | null;
	[key: string]: unknown;
}

function carName(car: CarResult): string {
	const parts = [car.make, car.model];
	if (car.year) parts.unshift(String(car.year));
	return parts.join(" ");
}

function fmtPrice(n: number): string {
	if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
	return `$${n}`;
}

const API_BASE = "/api";

export class CarSearch extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: block;
        position: relative;
      }
      .input-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      input {
        width: 100%;
        padding: 6px 28px 6px 9px;
        background: var(--ui-bg);
        border: 1px solid var(--ui-border);
        border-radius: 3px;
        color: var(--ui-text-bright);
        font-size: 12px;
        outline: none;
        font-family: var(--ui-sans);
      }
      input:focus {
        border-color: var(--ui-accent-dim);
      }
      input::placeholder {
        color: var(--ui-text);
      }
      .spinner {
        position: absolute;
        right: 7px;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 12px;
        border: 2px solid var(--ui-accent-dim);
        border-top-color: var(--ui-accent);
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      .spinner.hidden {
        display: none;
      }
      @keyframes spin {
        to {
          transform: translateY(-50%) rotate(360deg);
        }
      }
      .clear-btn {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: var(--ui-text);
        cursor: pointer;
        font-size: 12px;
        padding: 2px;
        line-height: 1;
        display: none;
      }
      .clear-btn:hover {
        color: var(--ui-text-bright);
      }
      .clear-btn.visible {
        display: block;
      }
      .clear-btn.visible + .spinner {
        display: none;
      }
      .results {
        position: fixed;
        background: var(--ui-panel-solid);
        border: 1px solid var(--ui-border);
        border-radius: 0 0 3px 3px;
        max-height: 220px;
        min-width: 240px;
        overflow-y: auto;
        z-index: 9999;
        display: none;
      }
      .results.open {
        display: block;
      }
      .results::-webkit-scrollbar {
        width: 3px;
      }
      .results::-webkit-scrollbar-thumb {
        background: var(--ui-accent-dim);
        border-radius: 2px;
      }
      .result-item {
        padding: 7px 9px;
        cursor: pointer;
        font-size: 12px;
        color: var(--ui-text-bright);
        border-bottom: 1px solid var(--ui-border);
        transition: background 0.1s;
      }
      .result-item:last-child {
        border-bottom: none;
      }
      .result-item:hover,
      .result-item.highlighted {
        background: var(--ui-accent-ghost);
        color: var(--ui-accent);
      }
      .result-name {
        font-weight: 500;
      }
      .result-meta {
        font-size: 10px;
        color: var(--ui-text);
        margin-top: 1px;
        font-family: var(--ui-mono);
      }
      .result-loading,
      .result-empty,
      .result-error {
        padding: 10px 9px;
        font-size: 11px;
        color: var(--ui-text);
        text-align: center;
      }
      .result-error {
        color: var(--ui-red);
      }
    `,
	];

	static override properties = {
		_query: { state: true },
		_results: { state: true },
		_loading: { state: true },
		_open: { state: true },
		_error: { state: true },
	};

	private declare _query: string;
	private declare _results: CarResult[];
	private declare _loading: boolean;
	private declare _open: boolean;
	private declare _error: string;
	private _highlightIdx = -1;
	private _debounce: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super();
		this._query = "";
		this._results = [];
		this._loading = false;
		this._open = false;
		this._error = "";
	}

	override render() {
		const showSpinner = this._loading;
		const showClear = this._query.length > 0 && !this._loading;

		return html`
      <div class="input-wrap">
        <input
          type="text"
          placeholder="Search cars..."
          .value=${this._query}
          @input=${this._onInput}
          @focus=${this._onFocus}
          @keydown=${this._onKeydown}
          aria-haspopup="listbox"
          aria-expanded=${this._open}
        />
        <button
          class="clear-btn ${showClear ? "visible" : ""}"
          @click=${this._clear}
          title="Clear"
        >
          &times;
        </button>
        <div class="spinner ${showSpinner ? "" : "hidden"}"></div>
      </div>
      <div
        class="results ${this._open ? "open" : ""}"
        role="listbox"
        style="${this._positionStyle()}"
      >
        ${this._renderResults()}
      </div>
    `;
	}

	private _renderResults(): TemplateResult {
		if (this._error) {
			return html`<div class="result-error">${this._error}</div>`;
		}
		if (this._loading) {
			return html`<div class="result-loading">Searching...</div>`;
		}
		if (this._results.length === 0 && this._query.length >= 2) {
			return html`<div class="result-empty">No results found</div>`;
		}
		return html`
      ${this._results.map(
				(car, i) => html`
          <div
            class="result-item ${i === this._highlightIdx ? "highlighted" : ""}"
            role="option"
            @click=${() => this._select(car)}
            @mouseenter=${() => {
							this._highlightIdx = i;
						}}
          >
            <div class="result-name">${carName(car)}</div>
            ${this._renderMeta(car)}
          </div>
        `,
			)}
    `;
	}

	private _renderMeta(car: CarResult): TemplateResult {
		const parts: string[] = [];
		if (car.year) parts.push(String(car.year));
		if (car.make) parts.push(car.make);
		if (car.bodyType) parts.push(car.bodyType);
		if (car.weightKg) parts.push(`${car.weightKg} kg`);
		const price = (car as any).price as { min_usd?: number; max_usd?: number; avg_usd?: number } | undefined;
		if (price?.avg_usd != null) {
			parts.push(fmtPrice(price.avg_usd));
		} else if (price?.min_usd != null) {
			parts.push(
				price.min_usd === price.max_usd || price.max_usd == null
					? fmtPrice(price.min_usd)
					: `${fmtPrice(price.min_usd)}-${fmtPrice(price.max_usd)}`,
			);
		}
		if (parts.length === 0) return html``;
		return html`<div class="result-meta">${parts.join(" / ")}</div>`;
	}

	private _onInput(e: Event) {
		this._query = (e.target as HTMLInputElement).value;
		this._highlightIdx = -1;
		this._error = "";

		if (this._debounce) clearTimeout(this._debounce);

		if (this._query.length < 2) {
			this._results = [];
			this._open = false;
			this._loading = false;
			return;
		}

		this._loading = true;
		this._open = true;

		this._debounce = setTimeout(() => {
			this._doSearch();
		}, 300);
	}

	private async _doSearch() {
		try {
			const resp = await fetch(`${API_BASE}/cars/search?q=${encodeURIComponent(this._query)}&limit=20&predict=true`);
			if (!resp.ok) throw new Error(`${resp.status}`);
			const data = await resp.json();
			this._results = Array.isArray(data) ? data : [];
		} catch (err) {
			this._error = "Search failed";
			this._results = [];
		} finally {
			this._loading = false;
		}
	}

	private _positionStyle(): string {
		const input = this.renderRoot.querySelector("input");
		if (!input) return "";
		const rect = input.getBoundingClientRect();
		return `top:${rect.bottom + 2}px;left:${rect.left}px;width:${rect.width}px;`;
	}
	private _onFocus() {
		if (this._results.length > 0 || this._loading) {
			this._open = true;
		}
	}

	private _onKeydown(e: KeyboardEvent) {
		if (!this._open) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			this._highlightIdx = Math.min(this._highlightIdx + 1, this._results.length - 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this._highlightIdx = Math.max(this._highlightIdx - 1, 0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (this._highlightIdx >= 0 && this._results[this._highlightIdx]) {
				this._select(this._results[this._highlightIdx]);
			}
		} else if (e.key === "Escape") {
			this._open = false;
		}
	}

	private _select(car: CarResult) {
		this._query = carName(car);
		this._open = false;
		this.dispatchEvent(
			new CustomEvent("car-selected", {
				detail: car,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _clear() {
		this._query = "";
		this._results = [];
		this._open = false;
		this._error = "";
		this._highlightIdx = -1;
		this.dispatchEvent(
			new CustomEvent("car-cleared", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Close dropdown when clicking outside */
	override connectedCallback() {
		super.connectedCallback();
		this._onDocClick = (e: MouseEvent) => {
			if (!e.composedPath().includes(this)) {
				this._open = false;
			}
		};
		document.addEventListener("click", this._onDocClick);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener("click", this._onDocClick!);
	}

	private _onDocClick: ((e: MouseEvent) => void) | null = null;
}

customElements.define("car-search", CarSearch);

declare global {
	interface HTMLElementTagNameMap {
		"car-search": CarSearch;
	}
}

export type { CarResult };
