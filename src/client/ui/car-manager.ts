/**
 * CarManager — modal for searching, loading, and deleting existing car configs.
 */
import { css, html, LitElement } from "lit";
import { svgIcon } from "./icons.ts";
import { themeStyles } from "./theme.ts";

const API_BASE = "/api";

interface CarEntry {
	id: number;
	name: string;
	status: string;
	s3Key?: string;
	createdAt: string;
	attribution: string | null;
	carName: string | null;
}

export class CarManager extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: contents;
			}
			.overlay {
				position: fixed;
				inset: 0;
				background: rgba(0, 0, 0, 0.6);
				z-index: 1000;
				display: flex;
				align-items: center;
				justify-content: center;
				backdrop-filter: blur(4px);
			}
			:host([hidden]) .overlay {
				display: none;
			}
			.modal {
				background: var(--ui-panel-solid);
				border: 1px solid var(--ui-border);
				border-radius: 8px;
				width: 480px;
				max-height: 80vh;
				display: flex;
				flex-direction: column;
				box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
			}
			.modal-header {
				display: flex;
				align-items: center;
				padding: 16px 20px 12px;
				border-bottom: 1px solid var(--ui-border);
				gap: 10px;
			}
			.modal-header h2 {
				font-size: 13px;
				font-weight: 600;
				color: var(--ui-text-white);
				margin: 0;
				flex: 1;
				letter-spacing: 0.5px;
			}
			.close-btn {
				background: none;
				border: none;
				color: var(--ui-text);
				cursor: pointer;
				padding: 4px;
				border-radius: 4px;
				display: flex;
				align-items: center;
				justify-content: center;
				transition: color 0.15s, background 0.15s;
			}
			.close-btn:hover {
				color: var(--ui-text-bright);
				background: var(--ui-accent-ghost);
			}
			.search-row {
				padding: 12px 20px 8px;
			}
			.search-input {
				width: 100%;
				padding: 8px 12px;
				background: var(--ui-bg);
				border: 1px solid var(--ui-border);
				border-radius: 6px;
				color: var(--ui-text-bright);
				font-size: 12px;
				font-family: var(--ui-sans);
				outline: none;
				box-sizing: border-box;
				transition: border-color 0.15s;
			}
			.search-input::placeholder {
				color: var(--ui-text-dim);
			}
			.search-input:focus {
				border-color: var(--ui-accent-dim);
			}
			.list {
				flex: 1;
				overflow-y: auto;
				padding: 4px 12px 12px;
			}
			.list::-webkit-scrollbar {
				width: 4px;
			}
			.list::-webkit-scrollbar-thumb {
				background: var(--ui-accent-ghost);
				border-radius: 2px;
			}
			.car-item {
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 10px 8px;
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.1s;
				border: 1px solid transparent;
			}
			.car-item:hover {
				background: var(--ui-accent-ghost);
				border-color: var(--ui-border);
			}
			.car-info {
				flex: 1;
				min-width: 0;
			}
			.car-name {
				font-size: 12px;
				font-weight: 600;
				color: var(--ui-text-bright);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.car-meta {
				font-size: 10px;
				color: var(--ui-text);
				margin-top: 2px;
			}
			.car-actions {
				display: flex;
				gap: 4px;
				opacity: 0;
				transition: opacity 0.15s;
			}
			.car-item:hover .car-actions {
				opacity: 1;
			}
			.icon-btn {
				background: none;
				border: 1px solid transparent;
				color: var(--ui-text);
				cursor: pointer;
				padding: 4px;
				border-radius: 4px;
				display: flex;
				align-items: center;
				justify-content: center;
				transition: all 0.15s;
			}
			.icon-btn:hover {
				color: var(--ui-text-bright);
				background: var(--ui-accent-ghost);
				border-color: var(--ui-border);
			}
			.icon-btn.danger:hover {
				color: var(--ui-red);
				background: var(--ui-red-dim);
				border-color: var(--ui-red);
			}
			.empty {
				padding: 32px 20px;
				text-align: center;
				color: var(--ui-text);
				font-size: 12px;
			}
			.confirm-delete {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 6px 8px;
				background: var(--ui-red-dim);
				border-radius: 4px;
				margin-top: 4px;
			}
			.confirm-delete span {
				font-size: 10px;
				color: var(--ui-red);
				flex: 1;
			}
			.confirm-delete button {
				font-size: 10px;
				padding: 2px 8px;
				border-radius: 3px;
				border: 1px solid var(--ui-red);
				background: transparent;
				color: var(--ui-red);
				cursor: pointer;
				font-family: var(--ui-sans);
			}
			.confirm-delete button.yes {
				background: var(--ui-red);
				color: #fff;
			}
			@keyframes fadeIn {
				from { opacity: 0; transform: scale(0.96); }
				to { opacity: 1; transform: scale(1); }
			}
			.modal {
				animation: fadeIn 0.15s ease-out;
			}
			@media (prefers-reduced-motion: reduce) {
				.modal { animation: none; }
			}
		`,
	];

	static override properties = {
		hidden: { type: Boolean, reflect: true },
	};

	// Internal reactive state — mutated directly, requestUpdate() called manually
	_cars: CarEntry[] = [];
	_loading = false;
	_confirmDeleteId: number | null = null;
	_query = "";
	_searchTimer = 0;

	override connectedCallback() {
		super.connectedCallback();
		this.hidden = true;
	}

	show() {
		this.hidden = false;
		this._query = "";
		this._confirmDeleteId = null;
		this._fetchCars();
		this.requestUpdate();
	}

	hide() {
		this.hidden = true;
		this._confirmDeleteId = null;
	}

	async _fetchCars() {
		this._loading = true;
		this.requestUpdate();
		try {
			const url = `${API_BASE}/cars/imported${this._query ? `?q=${encodeURIComponent(this._query)}` : ""}`;
			const resp = await fetch(url);
			if (!resp.ok) {
				this._cars = [];
				return;
			}
			const raw = (await resp.json()) as CarEntry[];
			// Normalize field name typo (old server returned "attribuption")
			this._cars = raw.map((c) => ({
				...c,
				attribution: ((c as unknown as Record<string, unknown>).attribution ??
					(c as unknown as Record<string, unknown>).attribuption ??
					null) as string | null,
			}));
			// Client-side name fallback: if name looks like a hash, parse from attribution
			this._cars = this._cars.map((c) => {
				if (/^[a-f0-9]{12,}$/.test(c.name) && c.attribution) {
					const parsed = c.attribution.replace(/^"|"$/g, "").split(" by ")[0]?.trim();
					if (parsed && parsed.length > 3) return { ...c, name: parsed };
				}
				return c;
			});
		} catch {
			this._cars = [];
		} finally {
			this._loading = false;
			this.requestUpdate();
		}
	}

	private _onSearch(e: InputEvent) {
		this._query = (e.target as HTMLInputElement).value;
		clearTimeout(this._searchTimer);
		this._searchTimer = window.setTimeout(() => this._fetchCars(), 250);
	}

	private _onLoad(car: CarEntry) {
		if (this._confirmDeleteId !== null) return;
		this.dispatchEvent(
			new CustomEvent("car-load", {
				detail: { id: car.id, s3Key: car.s3Key ?? "", name: car.name },
				bubbles: true,
				composed: true,
			}),
		);
		this.hide();
	}

	private _onDeleteClick(car: CarEntry, e: Event) {
		e.stopPropagation();
		this._confirmDeleteId = car.id;
		this.requestUpdate();
	}

	private _cancelDelete() {
		this._confirmDeleteId = null;
		this.requestUpdate();
	}

	private async _confirmDelete() {
		if (this._confirmDeleteId === null) return;
		const id = this._confirmDeleteId;
		this._confirmDeleteId = null;
		this.requestUpdate();
		try {
			const resp = await fetch(`${API_BASE}/cars/imported/${id}`, { method: "DELETE" });
			if (!resp.ok) {
				this.dispatchEvent(
					new CustomEvent("toast", {
						detail: { message: "Delete failed", type: "error" },
						bubbles: true,
						composed: true,
					}),
				);
				return;
			}
			this._cars = this._cars.filter((c) => c.id !== id);
			this.dispatchEvent(new CustomEvent("car-deleted", { detail: { id }, bubbles: true, composed: true }));
		} catch {
			this.dispatchEvent(
				new CustomEvent("toast", {
					detail: { message: "Delete failed", type: "error" },
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	private _onOverlayClick(e: Event) {
		if (e.target === e.currentTarget) this.hide();
	}

	private _onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") this.hide();
	}

	override render() {
		if (this.hidden) return html``;

		return html`
			<div class="overlay" @click=${this._onOverlayClick} @keydown=${this._onKeydown}>
				<div class="modal" role="dialog" aria-label="Manage cars">
					<div class="modal-header">
						${svgIcon(["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"], 16)}
						<h2>Saved Cars</h2>
						<button class="close-btn" @click=${this.hide} aria-label="Close">
							${svgIcon(["M18 6 6 18", "M6 6l12 12"], 16)}
						</button>
					</div>

					<div class="search-row">
						<input
							class="search-input"
							type="text"
							placeholder="Search by name, attribution..."
							.value=${this._query}
							@input=${this._onSearch}
							aria-label="Search cars"
						/>
					</div>

					<div class="list">
						${
							this._loading
								? html`<div class="empty">Loading...</div>`
								: this._cars.length === 0
									? html`<div class="empty">${this._query ? "No cars match your search" : "No saved cars yet"}</div>`
									: this._cars.map(
											(car) => html`
											<div class="car-item" @click=${() => this._onLoad(car)}>
												${svgIcon(["M6 4l14 8-14 8V4"], 16)}
												<div class="car-info">
													<div class="car-name">${car.name}</div>
													<div class="car-meta">#${car.id} · ${car.createdAt?.slice(0, 10)}</div>
													${
														this._confirmDeleteId === car.id
															? html`
															<div class="confirm-delete">
																<span>Delete permanently?</span>
																<button class="yes" @click=${(e: Event) => {
																	e.stopPropagation();
																	this._confirmDelete();
																}}>Yes</button>
																<button @click=${(e: Event) => {
																	e.stopPropagation();
																	this._cancelDelete();
																}}>No</button>
															</div>
														`
															: ""
													}
												</div>
												<div class="car-actions">
													<button
														class="icon-btn danger"
														@click=${(e: Event) => this._onDeleteClick(car, e)}
														aria-label="Delete car"
														title="Delete"
													>
														${svgIcon(
															[
																"M3 6h18",
																"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
																"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
																"M10 11v6",
																"M14 11v6",
															],
															14,
														)}
													</button>
												</div>
											</div>
										`,
										)
						}
					</div>
				</div>
			</div>
		`;
	}
}

customElements.define("car-manager", CarManager);

declare global {
	interface HTMLElementTagNameMap {
		"car-manager": CarManager;
	}
}
