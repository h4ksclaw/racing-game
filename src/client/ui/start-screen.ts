/**
 * StartScreen — centered modal flow for choosing what to do in the editor.
 * Three options: Edit existing vehicle, Create new vehicle, Pick pending model.
 * Each drills into a step-by-step sub-flow with Back navigation.
 */
import { css, html, LitElement, type TemplateResult } from "lit";
import { svgIcon } from "./icons.ts";
import { themeStyles } from "./theme.ts";

const API_BASE = "/api";

// ── Types ──
interface CarEntry {
	id: number;
	name: string;
	carName?: string | null;
	status: string;
	s3Key?: string;
	createdAt: string;
	attribution: string | null;
}

interface PendingAsset {
	hash: string;
	originalName: string;
	size: number;
	status: string;
	sourceUrl?: string;
	attribution?: string;
}

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
	} | null;
	price?: { min_usd?: number; max_usd?: number; avg_usd?: number };
}

type Step = "home" | "edit-list" | "create-car" | "create-model" | "pending-list";

export class StartScreen extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				display: block;
			}
			.overlay {
				position: fixed;
				inset: 0;
				background: rgba(0, 0, 0, 0.65);
				z-index: 2000;
				display: flex;
				align-items: center;
				justify-content: center;
				backdrop-filter: blur(6px);
			}
			:host([hidden]) .overlay {
				display: none;
			}
			.modal {
				background: var(--ui-panel-solid);
				border: 1px solid var(--ui-border);
				border-radius: 10px;
				width: 540px;
				max-width: 95vw;
				max-height: 85vh;
				display: flex;
				flex-direction: column;
				box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
				animation: fadeIn 0.2s ease-out;
			}
			@keyframes fadeIn {
				from { opacity: 0; transform: scale(0.97); }
				to { opacity: 1; transform: scale(1); }
			}
			@media (prefers-reduced-motion: reduce) {
				.modal { animation: none; }
			}
			.modal-header {
				display: flex;
				align-items: center;
				padding: 18px 24px 14px;
				gap: 10px;
				border-bottom: 1px solid var(--ui-border);
			}
			.modal-header h2 {
				font-size: 14px;
				font-weight: 600;
				color: var(--ui-text-white);
				margin: 0;
				flex: 1;
				letter-spacing: 0.3px;
			}
			.modal-header .subtitle {
				font-size: 11px;
				color: var(--ui-text);
				margin-top: 2px;
			}
			.back-btn {
				background: none;
				border: 1px solid var(--ui-border);
				color: var(--ui-text-bright);
				cursor: pointer;
				padding: 5px 10px;
				border-radius: 4px;
				font-size: 11px;
				font-family: var(--ui-sans);
				display: flex;
				align-items: center;
				gap: 5px;
				transition: all 0.12s;
			}
			.back-btn:hover {
				background: var(--ui-accent-ghost);
				border-color: var(--ui-accent-dim);
				color: var(--ui-accent);
			}
			.modal-body {
				flex: 1;
				overflow-y: auto;
				padding: 20px 24px;
			}
			.modal-body::-webkit-scrollbar { width: 4px; }
			.modal-body::-webkit-scrollbar-thumb { background: var(--ui-accent-ghost); border-radius: 2px; }

			/* ── Home grid ── */
			.card-grid {
				display: grid;
				grid-template-columns: 1fr 1fr 1fr;
				gap: 12px;
			}
			.card {
				background: var(--ui-bg);
				border: 1px solid var(--ui-border);
				border-radius: 8px;
				padding: 20px 16px;
				cursor: pointer;
				transition: all 0.15s;
				display: flex;
				flex-direction: column;
				align-items: center;
				text-align: center;
				gap: 10px;
			}
			.card:hover {
				border-color: var(--ui-accent-dim);
				background: var(--ui-accent-ghost);
				transform: translateY(-2px);
				box-shadow: 0 4px 16px rgba(92, 158, 255, 0.1);
			}
			.card-icon {
				width: 44px;
				height: 44px;
				border-radius: 10px;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--ui-accent);
				flex-shrink: 0;
			}
			.card-icon.edit { background: rgba(92, 158, 255, 0.1); }
			.card-icon.create { background: rgba(163, 230, 53, 0.1); color: var(--ui-green); }
			.card-icon.pending { background: rgba(255, 140, 75, 0.1); color: var(--ui-orange); }
			.card-title {
				font-size: 12px;
				font-weight: 600;
				color: var(--ui-text-bright);
			}
			.card-desc {
				font-size: 10px;
				color: var(--ui-text);
				line-height: 1.4;
			}

			/* ── List views ── */
			.list-search {
				margin-bottom: 12px;
			}
			.list-search input {
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
			.list-search input::placeholder { color: var(--ui-text-dim); }
			.list-search input:focus { border-color: var(--ui-accent-dim); }

			.list-item {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 10px 8px;
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.1s;
				border: 1px solid transparent;
			}
			.list-item:hover {
				background: var(--ui-accent-ghost);
				border-color: var(--ui-border);
			}
			.list-item-info { flex: 1; min-width: 0; }
			.list-item-name {
				font-size: 12px;
				font-weight: 500;
				color: var(--ui-text-bright);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.list-item-meta {
				font-size: 10px;
				color: var(--ui-text);
				margin-top: 1px;
				font-family: var(--ui-mono);
			}
			.list-item-actions {
				display: flex;
				gap: 4px;
				opacity: 0;
				transition: opacity 0.15s;
			}
			.list-item:hover .list-item-actions { opacity: 1; }
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
			.empty-state {
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

			/* ── Create flow ── */
			.create-section-label {
				font-size: 10px;
				text-transform: uppercase;
				letter-spacing: 1.5px;
				color: var(--ui-text);
				font-weight: 600;
				margin-bottom: 8px;
			}
			.create-search-wrap {
				position: relative;
				margin-bottom: 14px;
			}
			.create-search-wrap input {
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
			}
			.create-search-wrap input::placeholder { color: var(--ui-text-dim); }
			.create-search-wrap input:focus { border-color: var(--ui-accent-dim); }
			.create-search-results {
				position: absolute;
				top: 100%;
				left: 0;
				right: 0;
				background: var(--ui-panel-solid);
				border: 1px solid var(--ui-border);
				border-radius: 0 0 6px 6px;
				max-height: 200px;
				overflow-y: auto;
				z-index: 10;
				display: none;
			}
			.create-search-results.open { display: block; }
			.create-search-results::-webkit-scrollbar { width: 3px; }
			.create-search-results::-webkit-scrollbar-thumb { background: var(--ui-accent-ghost); border-radius: 2px; }
			.car-result-item {
				padding: 7px 10px;
				cursor: pointer;
				font-size: 12px;
				color: var(--ui-text-bright);
				border-bottom: 1px solid var(--ui-border);
				transition: background 0.1s;
			}
			.car-result-item:last-child { border-bottom: none; }
			.car-result-item:hover { background: var(--ui-accent-ghost); }
			.car-result-meta {
				font-size: 10px;
				color: var(--ui-text);
				margin-top: 1px;
				font-family: var(--ui-mono);
			}
			.skip-link {
				display: block;
				text-align: center;
				font-size: 11px;
				color: var(--ui-text);
				margin-bottom: 16px;
				cursor: pointer;
				padding: 4px;
				border-radius: 3px;
				transition: color 0.12s;
			}
			.skip-link:hover { color: var(--ui-accent); }

			.model-source-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 12px;
			}
			.model-source-card {
				background: var(--ui-bg);
				border: 1px solid var(--ui-border);
				border-radius: 8px;
				padding: 18px 14px;
				cursor: pointer;
				transition: all 0.15s;
				display: flex;
				flex-direction: column;
				align-items: center;
				text-align: center;
				gap: 8px;
			}
			.model-source-card:hover {
				border-color: var(--ui-accent-dim);
				background: var(--ui-accent-ghost);
			}
			.model-source-card .card-icon { width: 36px; height: 36px; border-radius: 8px; }
			.model-source-card .card-title { font-size: 12px; font-weight: 600; color: var(--ui-text-bright); }
			.model-source-card .card-desc { font-size: 10px; color: var(--ui-text); line-height: 1.3; }

			/* Sketchfab search in create flow */
			.sf-search-row {
				display: flex;
				gap: 6px;
				margin-bottom: 10px;
			}
			.sf-search-row input {
				flex: 1;
				padding: 7px 10px;
				background: var(--ui-bg);
				border: 1px solid var(--ui-border);
				border-radius: 5px;
				color: var(--ui-text-bright);
				font-size: 12px;
				font-family: var(--ui-sans);
				outline: none;
			}
			.sf-search-row input:focus { border-color: var(--ui-accent-dim); }
			.sf-search-row button {
				padding: 7px 14px;
				background: var(--ui-accent-dim);
				border: 1px solid var(--ui-accent);
				border-radius: 5px;
				color: var(--ui-text-white);
				font-size: 11px;
				font-family: var(--ui-sans);
				cursor: pointer;
				white-space: nowrap;
				transition: background 0.12s;
			}
			.sf-search-row button:hover { background: var(--ui-accent); }
			.sf-search-row button:disabled { opacity: 0.4; cursor: not-allowed; }
			.sf-results-list {
				max-height: 260px;
				overflow-y: auto;
			}
			.sf-results-list::-webkit-scrollbar { width: 3px; }
			.sf-results-list::-webkit-scrollbar-thumb { background: var(--ui-accent-ghost); border-radius: 2px; }
			.sf-result-item {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 8px;
				border-radius: 5px;
				cursor: pointer;
				transition: background 0.1s;
				border: 1px solid transparent;
				margin-bottom: 3px;
			}
			.sf-result-item:hover {
				background: var(--ui-accent-ghost);
				border-color: var(--ui-border);
			}
			.sf-result-thumb {
				width: 44px;
				height: 44px;
				border-radius: 4px;
				object-fit: cover;
				flex-shrink: 0;
			}
			.sf-result-info { flex: 1; min-width: 0; }
			.sf-result-name {
				font-size: 11px;
				font-weight: 500;
				color: var(--ui-text-bright);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.sf-result-meta {
				font-size: 9px;
				color: var(--ui-text);
				margin-top: 1px;
			}
			.sf-download-btn {
				padding: 3px 8px;
				background: var(--ui-accent-dim);
				border: 1px solid var(--ui-accent);
				border-radius: 3px;
				color: var(--ui-text-white);
				font-size: 10px;
				font-family: var(--ui-sans);
				cursor: pointer;
				flex-shrink: 0;
			}
			.sf-download-btn:hover { background: var(--ui-accent); }
			.sf-download-btn:disabled { opacity: 0.4; cursor: not-allowed; }
			.sf-download-status { font-size: 9px; color: var(--ui-text); flex-shrink: 0; }
			.cc-badge {
				background: rgba(163,230,53,0.12);
				color: var(--ui-green);
				padding: 1px 5px;
				border-radius: 3px;
				font-size: 9px;
				font-weight: 600;
			}
			.sf-empty {
				padding: 12px;
				text-align: center;
				color: var(--ui-text);
				font-size: 11px;
			}
			.sf-load-more {
				text-align: center;
				padding: 6px;
				color: var(--ui-text);
				font-size: 10px;
				cursor: pointer;
			}
			.sf-load-more:hover { color: var(--ui-accent); }

			/* Upload area in create flow */
			.upload-zone {
				border: 2px dashed var(--ui-border);
				border-radius: 8px;
				padding: 32px 20px;
				text-align: center;
				cursor: pointer;
				transition: all 0.15s;
				color: var(--ui-text-bright);
			}
			.upload-zone:hover, .upload-zone.drag-over {
				border-color: var(--ui-accent-dim);
				background: var(--ui-accent-ghost);
				color: var(--ui-accent);
			}
			.upload-zone input { display: none; }
			.upload-zone .upload-icon { margin-bottom: 8px; }
			.upload-zone .upload-text { font-size: 12px; font-weight: 500; }
			.upload-zone .upload-hint { font-size: 10px; color: var(--ui-text); margin-top: 4px; }

			/* Selected car indicator */
			.selected-car-bar {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 8px 12px;
				background: var(--ui-accent-ghost);
				border: 1px solid var(--ui-accent-dim);
				border-radius: 6px;
				margin-bottom: 14px;
				font-size: 11px;
				color: var(--ui-accent);
			}
			.selected-car-bar .car-name { font-weight: 600; color: var(--ui-text-bright); }
			.selected-car-bar .change-btn {
				margin-left: auto;
				background: none;
				border: none;
				color: var(--ui-text);
				cursor: pointer;
				font-size: 10px;
				padding: 2px 6px;
				border-radius: 3px;
			}
			.selected-car-bar .change-btn:hover { background: var(--ui-accent-ghost); color: var(--ui-accent); }

			.spinner-wrap {
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 10px;
				padding: 32px;
				color: var(--ui-text);
				font-size: 12px;
			}
			.spinner {
				width: 16px;
				height: 16px;
				border: 2px solid var(--ui-accent-dim);
				border-top-color: var(--ui-accent);
				border-radius: 50%;
				animation: spin 0.6s linear infinite;
			}
			@keyframes spin { to { transform: rotate(360deg); } }
		`,
	];

	static override properties = {
		hidden: { type: Boolean, reflect: true },
	};

	// Internal reactive state
	_step: Step = "home";
	_loading = false;
	_editCars: CarEntry[] = [];
	_editQuery = "";
	_editConfirmDeleteId: number | null = null;
	_pendingAssets: PendingAsset[] = [];
	_selectedCar: CarResult | null = null;
	_carSearchResults: CarResult[] = [];
	_carSearchLoading = false;
	_carSearchOpen = false;
	_carSearchQuery = "";
	_sfQuery = "";
	_sfResults: any[] = [];
	_sfNextCursor: string | null = null;
	_sfLoading = false;
	_downloadingUid: string | null = null;
	_searchTimer = 0;
	_sfSearchTimer = 0;

	override connectedCallback() {
		super.connectedCallback();
		this.hidden = false;
	}

	show() {
		this.hidden = false;
		this._step = "home";
		this._selectedCar = null;
		this.requestUpdate();
	}

	hide() {
		this.hidden = true;
	}

	// ── Navigation ──
	private _goHome() {
		this._step = "home";
		this._selectedCar = null;
		this._editConfirmDeleteId = null;
		this.requestUpdate();
	}

	private _goTo(step: Step) {
		this._step = step;
		this.requestUpdate();
	}

	// ── Edit Vehicle ──
	private async _fetchEditCars() {
		this._loading = true;
		this.requestUpdate();
		try {
			const url = `${API_BASE}/cars/imported${this._editQuery ? `?q=${encodeURIComponent(this._editQuery)}` : ""}`;
			const resp = await fetch(url);
			if (!resp.ok) {
				this._editCars = [];
				return;
			}
			const raw = (await resp.json()) as CarEntry[];
			this._editCars = raw.map((c) => {
				// Prefer carName if set, otherwise try to extract from attribution
				if (c.carName && c.carName.trim()) return { ...c, name: c.carName.trim() };
				if (/^[a-f0-9]{12,}$/.test(c.name) && c.attribution) {
					const parsed =
						c.attribution.replace(/^"([^"]*)".*$/, "$1").trim() ||
						c.attribution.split(" by ")[0]?.replace(/"/g, "").trim() ||
						"";
					if (parsed && parsed.length > 3) return { ...c, name: parsed };
				}
				return c;
			});
		} catch {
			this._editCars = [];
		} finally {
			this._loading = false;
			this.requestUpdate();
		}
	}

	private _onEditSearch(e: InputEvent) {
		this._editQuery = (e.target as HTMLInputElement).value;
		clearTimeout(this._searchTimer);
		this._searchTimer = window.setTimeout(() => this._fetchEditCars(), 250);
	}

	private _onEditCardClick() {
		this._goTo("edit-list");
		this._editQuery = "";
		this._editConfirmDeleteId = null;
		this._fetchEditCars();
	}

	private _onEditSelect(car: CarEntry) {
		if (this._editConfirmDeleteId !== null) return;
		this._loading = true;
		this.requestUpdate();
		// Small delay so the loading state renders
		setTimeout(() => {
			this._loading = false;
			this.hidden = true;
			this.dispatchEvent(
				new CustomEvent("start-edit", {
					detail: { configId: car.id, s3Key: car.s3Key ?? "", name: car.name },
					bubbles: true,
					composed: true,
				}),
			);
		}, 300);
	}

	private _onDeleteEditCar(car: CarEntry, e: Event) {
		e.stopPropagation();
		this._editConfirmDeleteId = car.id;
		this.requestUpdate();
	}

	private async _confirmDeleteEditCar() {
		if (this._editConfirmDeleteId === null) return;
		const id = this._editConfirmDeleteId;
		this._editConfirmDeleteId = null;
		this.requestUpdate();
		try {
			const resp = await fetch(`${API_BASE}/cars/imported/${id}`, { method: "DELETE" });
			if (resp.ok) {
				this._editCars = this._editCars.filter((c) => c.id !== id);
				this.dispatchEvent(new CustomEvent("car-deleted", { detail: { id }, bubbles: true, composed: true }));
			}
		} catch {
			/* ignore */
		}
	}

	// ── Create New Vehicle ──
	private _onCreateCardClick() {
		this._goTo("create-car");
		this._selectedCar = null;
		this._carSearchQuery = "";
		this._carSearchResults = [];
	}

	private _onCarSearchInput(e: InputEvent) {
		this._carSearchQuery = (e.target as HTMLInputElement).value;
		this._carSearchOpen = true;
		this._carSearchLoading = true;
		this.requestUpdate();
		clearTimeout(this._searchTimer);
		if (this._carSearchQuery.length < 2) {
			this._carSearchResults = [];
			this._carSearchLoading = false;
			return;
		}
		this._searchTimer = window.setTimeout(() => this._doCarSearch(), 300);
	}

	private async _doCarSearch() {
		try {
			const resp = await fetch(
				`${API_BASE}/cars/search?q=${encodeURIComponent(this._carSearchQuery)}&limit=20&predict=true`,
			);
			if (!resp.ok) throw new Error(`${resp.status}`);
			this._carSearchResults = (await resp.json()) as CarResult[];
		} catch {
			this._carSearchResults = [];
		} finally {
			this._carSearchLoading = false;
			this.requestUpdate();
		}
	}

	private _onCarSearchSelect(car: CarResult) {
		this._selectedCar = car;
		this._carSearchOpen = false;
		this.requestUpdate();
	}

	private _onCarSearchClear() {
		this._selectedCar = null;
		this._carSearchQuery = "";
		this._carSearchResults = [];
		this._carSearchOpen = false;
		this.requestUpdate();
	}

	private _onSkipCarSearch() {
		this._selectedCar = null;
		this._goTo("create-model");
	}

	private _onCarSearchNext() {
		this._goTo("create-model");
	}

	private _onModelSourceBack() {
		this._goTo("create-car");
	}

	private _onModelUploadClick() {
		const input = this.renderRoot.querySelector<HTMLInputElement>(".upload-zone input");
		input?.click();
	}

	private _onModelFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) this._handleUpload(file);
	}

	private _onUploadDragOver(e: DragEvent) {
		e.preventDefault();
		this.renderRoot.querySelector(".upload-zone")?.classList.add("drag-over");
	}

	private _onUploadDragLeave() {
		this.renderRoot.querySelector(".upload-zone")?.classList.remove("drag-over");
	}

	private _onUploadDrop(e: DragEvent) {
		e.preventDefault();
		this.renderRoot.querySelector(".upload-zone")?.classList.remove("drag-over");
		const file = e.dataTransfer?.files[0];
		if (file) this._handleUpload(file);
	}

	private async _handleUpload(file: File) {
		this._loading = true;
		this.requestUpdate();
		try {
			const formData = new FormData();
			formData.append("model", file);
			const resp = await fetch(`${API_BASE}/assets/upload`, { method: "POST", body: formData });
			if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
			const data = await resp.json();
			const path = `/api/assets/file/${data.hash}`;
			const name = file.name.replace(/\.(glb|gltf)$/i, "");
			setTimeout(() => {
				this._loading = false;
				this.hidden = true;
				this.dispatchEvent(
					new CustomEvent("start-create", {
						detail: {
							carData: this._selectedCar ? this._serializeCarData(this._selectedCar) : null,
							modelPath: path,
							modelName: name,
							attribution: undefined,
						},
						bubbles: true,
						composed: true,
					}),
				);
			}, 300);
		} catch (err) {
			this._loading = false;
			this.requestUpdate();
			console.error("Upload failed:", err);
		}
	}

	private _onSketchfabSearchClick() {
		this._doSketchfabSearch();
	}

	private _onSfQueryInput(e: InputEvent) {
		this._sfQuery = (e.target as HTMLInputElement).value;
	}

	private _onSfQueryKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") this._doSketchfabSearch();
	}

	private async _doSketchfabSearch(cursor?: string) {
		if (this._sfQuery.length < 2) return;
		this._sfLoading = true;
		this.requestUpdate();
		const params = new URLSearchParams({ q: this._sfQuery, limit: "12", sort_by: "-likeCount" });
		if (cursor) params.set("cursor", cursor);
		try {
			const resp = await fetch(`${API_BASE}/sketchfab/search?${params}`);
			const data = await resp.json();
			this._sfResults = cursor ? [...this._sfResults, ...data.results] : data.results;
			this._sfNextCursor = data.nextCursor || null;
		} catch {
			this._sfResults = [];
		} finally {
			this._sfLoading = false;
			this.requestUpdate();
		}
	}

	private async _onSfDownload(uid: string, name: string) {
		this._downloadingUid = uid;
		this.requestUpdate();
		try {
			const resp = await fetch(`${API_BASE}/sketchfab/download`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uid }),
			});
			const data = (await resp.json()) as any;
			if (resp.ok && data) {
				// Wait for pending assets to update, then auto-load
				await new Promise((r) => setTimeout(r, 500));
				const pendingResp = await fetch(`${API_BASE}/assets/pending`);
				const assets = await pendingResp.json();
				const match = assets.find(
					(a: PendingAsset) =>
						a.originalName.includes(name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)) || a.attribution?.includes(name),
				);
				const asset = match || assets[0];
				if (asset) {
					const path = `/api/assets/file/${asset.hash}`;
					const assetName = asset.originalName.replace(/\.(glb|gltf)$/i, "");
					setTimeout(() => {
						this._loading = false;
						this._downloadingUid = null;
						this.hidden = true;
						this.dispatchEvent(
							new CustomEvent("start-create", {
								detail: {
									carData: this._selectedCar ? this._serializeCarData(this._selectedCar) : null,
									modelPath: path,
									modelName: assetName,
									attribution: asset.attribution,
								},
								bubbles: true,
								composed: true,
							}),
						);
					}, 300);
					return;
				}
			}
			this._downloadingUid = null;
			this.requestUpdate();
		} catch {
			this._downloadingUid = null;
			this.requestUpdate();
		}
	}

	private _serializeCarData(car: CarResult) {
		return {
			name: `${car.make} ${car.model}`,
			weightKg: car.weightKg,
			weightFrontPct: car.weightFrontPct,
			dims:
				car.dimensions && car.dimensions.length_m && car.dimensions.width_m && car.dimensions.height_m
					? { length_m: car.dimensions.length_m, width_m: car.dimensions.width_m, height_m: car.dimensions.height_m }
					: null,
			price: car.price,
		};
	}

	// ── Pending Assets ──
	private async _fetchPending() {
		this._loading = true;
		this.requestUpdate();
		try {
			const resp = await fetch(`${API_BASE}/assets/pending`);
			this._pendingAssets = await resp.json();
		} catch {
			this._pendingAssets = [];
		} finally {
			this._loading = false;
			this.requestUpdate();
		}
	}

	private _onPendingCardClick() {
		this._goTo("pending-list");
		this._fetchPending();
	}

	private _onPendingSelect(asset: PendingAsset) {
		this._loading = true;
		this.requestUpdate();
		setTimeout(() => {
			this._loading = false;
			this.hidden = true;
			this.dispatchEvent(
				new CustomEvent("start-pending", {
					detail: {
						path: `/api/assets/file/${asset.hash}`,
						name: asset.originalName.replace(/\.(glb|gltf)$/i, ""),
						attribution: asset.attribution,
					},
					bubbles: true,
					composed: true,
				}),
			);
		}, 300);
	}

	private async _onPendingDelete(asset: PendingAsset, e: Event) {
		e.stopPropagation();
		try {
			await fetch(`${API_BASE}/assets/${asset.hash}`, { method: "DELETE" });
			this._pendingAssets = this._pendingAssets.filter((a) => a.hash !== asset.hash);
			this.requestUpdate();
		} catch {
			/* ignore */
		}
	}

	// ── Helpers ──
	private _formatBytes(bytes: number): string {
		if (bytes <= 0) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1048576).toFixed(1)} MB`;
	}

	private _fmtPrice(n: number): string {
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
		return `$${n}`;
	}

	// ── Render ──
	override render() {
		if (this.hidden) return html``;

		return html`
			<div class="overlay">
				<div class="modal" role="dialog" aria-label="Vehicle editor start">
					<div class="modal-header">
						<div style="flex:1">
							<h2>${this._stepTitle()}</h2>
							${this._step === "home" ? html`<div class="subtitle">Create or edit vehicles</div>` : ""}
						</div>
						${
							this._step !== "home"
								? html`
							<button class="back-btn" @click=${this._goHome}>
								${svgIcon(["M19 12H5", "M12 19l-7-7 7-7"], 14)}
								Back
							</button>
						`
								: ""
						}
					</div>
					<div class="modal-body">
						${this._loading ? html`<div class="spinner-wrap"><div class="spinner"></div>Preparing editor...</div>` : this._renderBody()}
					</div>
				</div>
			</div>
		`;
	}

	private _stepTitle(): string {
		switch (this._step) {
			case "home":
				return "Car Editor";
			case "edit-list":
				return "Edit Vehicle";
			case "create-car":
				return "Create New Vehicle — Car Data";
			case "create-model":
				return "Create New Vehicle — Model";
			case "pending-list":
				return "Pick Pending Model";
			default:
				return "Car Editor";
		}
	}

	private _renderBody(): TemplateResult {
		switch (this._step) {
			case "home":
				return this._renderHome();
			case "edit-list":
				return this._renderEditList();
			case "create-car":
				return this._renderCreateCar();
			case "create-model":
				return this._renderCreateModel();
			case "pending-list":
				return this._renderPendingList();
			default:
				return html``;
		}
	}

	private _renderHome(): TemplateResult {
		return html`
			<div class="card-grid">
				<div class="card" @click=${this._onEditCardClick}>
					<div class="card-icon edit">
						${svgIcon(["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7", "M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"], 22)}
					</div>
					<div class="card-title">Edit Vehicle</div>
					<div class="card-desc">Load and edit an existing vehicle</div>
				</div>
				<div class="card" @click=${this._onCreateCardClick}>
					<div class="card-icon create">
						${svgIcon(["M12 5v14", "M5 12h14"], 22)}
					</div>
					<div class="card-title">Create New</div>
					<div class="card-desc">Start from scratch with a new model</div>
				</div>
				<div class="card" @click=${this._onPendingCardClick}>
					<div class="card-icon pending">
						${svgIcon(["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"], 22)}
					</div>
					<div class="card-title">Pending Model</div>
					<div class="card-desc">Use a previously uploaded model</div>
				</div>
			</div>
		`;
	}

	private _renderEditList(): TemplateResult {
		return html`
			<div class="list-search">
				<input type="text" placeholder="Search by name, attribution..." .value=${this._editQuery} @input=${this._onEditSearch} />
			</div>
			<div>
				${
					this._editCars.length === 0
						? html`<div class="empty-state">${this._editQuery ? "No cars match your search" : "No saved cars yet"}</div>`
						: this._editCars.map(
								(car) => html`
						<div class="list-item" @click=${() => this._onEditSelect(car)}>
							${svgIcon(["M6 4l14 8-14 8V4"], 16)}
							<div class="list-item-info">
								<div class="list-item-name">${car.name}</div>
								<div class="list-item-meta">#${car.id} · ${car.createdAt?.slice(0, 10)}</div>
								${
									this._editConfirmDeleteId === car.id
										? html`
									<div class="confirm-delete">
										<span>Delete permanently?</span>
										<button class="yes" @click=${(e: Event) => {
											e.stopPropagation();
											this._confirmDeleteEditCar();
										}}>Yes</button>
										<button @click=${(e: Event) => {
											e.stopPropagation();
											this._editConfirmDeleteId = null;
											this.requestUpdate();
										}}>No</button>
									</div>
								`
										: ""
								}
							</div>
							<div class="list-item-actions">
								<button class="icon-btn danger" @click=${(e: Event) => this._onDeleteEditCar(car, e)} title="Delete">
									${svgIcon(["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"], 14)}
								</button>
							</div>
						</div>
					`,
							)
				}
			</div>
		`;
	}

	private _renderCreateCar(): TemplateResult {
		return html`
			<div class="create-section-label">Step 1: Select car data (optional)</div>
			<div class="create-search-wrap">
				<input type="text" placeholder="Search car database..." .value=${this._carSearchQuery} @input=${this._onCarSearchInput} @focus=${() => {
					if (this._carSearchResults.length > 0) {
						this._carSearchOpen = true;
						this.requestUpdate();
					}
				}} />
				<div class="create-search-results ${this._carSearchOpen ? "open" : ""}">
					${
						this._carSearchLoading
							? html`<div class="sf-empty">Searching...</div>`
							: this._carSearchResults.length === 0 && this._carSearchQuery.length >= 2
								? html`<div class="sf-empty">No results found</div>`
								: this._carSearchResults.map(
										(car) => html`
								<div class="car-result-item" @click=${() => this._onCarSearchSelect(car)}>
									<div style="font-weight:500">${car.year ? `${car.year} ` : ""}${car.make} ${car.model}</div>
									<div class="car-result-meta">
										${[car.bodyType, car.weightKg ? `${car.weightKg} kg` : null, car.price?.avg_usd != null ? this._fmtPrice(car.price.avg_usd) : null].filter(Boolean).join(" / ")}
									</div>
								</div>
							`,
									)
					}
				</div>
			</div>

			${
				this._selectedCar
					? html`
				<div class="selected-car-bar">
					${svgIcon(["M5 13l4 4L19 7"], 14)}
					<span class="car-name">${this._selectedCar.year ? `${this._selectedCar.year} ` : ""}${this._selectedCar.make} ${this._selectedCar.model}</span>
					<button class="change-btn" @click=${this._onCarSearchClear}>Change</button>
				</div>
			`
					: ""
			}

			<div style="display:flex;gap:8px;justify-content:flex-end;">
				<span class="skip-link" @click=${this._onSkipCarSearch}>Skip — no car data</span>
				<button class="back-btn" style="background:var(--ui-accent-dim);border-color:var(--ui-accent);color:var(--ui-text-white);" @click=${this._onCarSearchNext}>
					Next — Choose Model →
				</button>
			</div>
		`;
	}

	private _renderCreateModel(): TemplateResult {
		return html`
			${
				this._selectedCar
					? html`
				<div class="selected-car-bar">
					${svgIcon(["M5 13l4 4L19 7"], 14)}
					<span class="car-name">${this._selectedCar.year ? `${this._selectedCar.year} ` : ""}${this._selectedCar.make} ${this._selectedCar.model}</span>
				</div>
			`
					: ""
			}

			<div class="create-section-label">Step 2: Choose a 3D model</div>
			<div class="model-source-grid">
				<div class="model-source-card" @click=${this._onModelUploadClick}>
					<div class="card-icon" style="background:rgba(92,158,255,0.1);color:var(--ui-accent);">
						${svgIcon(["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"], 20)}
					</div>
					<div class="card-title">Upload GLB</div>
					<div class="card-desc">Browse or drag & drop a model file</div>
				</div>
				<div class="model-source-card" @click=${() => this._goTo("create-model")}>
					<div class="card-icon" style="background:rgba(163,230,53,0.1);color:var(--ui-green);">
						${svgIcon(["M21 21l-6-6", "M10.5 3a7.5 7.5 0 105 12.3", "M10.5 3v7.5H18"], 20)}
					</div>
					<div class="card-title">Search Sketchfab</div>
					<div class="card-desc">Find and download a 3D model</div>
				</div>
			</div>

			<!-- Hidden upload input -->
			<div class="upload-zone" style="display:none;" @dragover=${this._onUploadDragOver} @dragleave=${this._onUploadDragLeave} @drop=${this._onUploadDrop} @click=${this._onModelUploadClick}>
				<input type="file" accept=".glb,.gltf" @change=${this._onModelFileChange} />
			</div>

			<!-- Sketchfab search -->
			<div style="margin-top:16px;">
				<div class="sf-search-row">
					<input type="text" placeholder="Search Sketchfab..." .value=${this._sfQuery} @input=${this._onSfQueryInput} @keydown=${this._onSfQueryKeydown} />
					<button ?disabled=${this._sfLoading || this._sfQuery.length < 2} @click=${this._onSketchfabSearchClick}>Search</button>
				</div>
				<div class="sf-results-list">
					${
						this._sfLoading
							? html`<div class="sf-empty">Searching Sketchfab...</div>`
							: this._sfResults.length === 0 && this._sfQuery.length >= 2
								? html`<div class="sf-empty">No models found. Try different keywords.</div>`
								: this._sfResults.map(
										(r: any) => html`
								<div class="sf-result-item">
									${r.thumbnail ? html`<img class="sf-result-thumb" src="${r.thumbnail.replace(/\/(\d+)\//, "/512/")}" alt="" loading="lazy" />` : ""}
									<div class="sf-result-info">
										<div class="sf-result-name">${r.name ?? "Unnamed"}</div>
										<div class="sf-result-meta">
											${r.isCc ? html`<span class="cc-badge">CC</span>` : ""}
											${[r.author, r.faceCount ? `${(r.faceCount / 1000).toFixed(0)}k tris` : null, r.likeCount ? `${r.likeCount} likes` : null].filter(Boolean).join(" · ")}
										</div>
									</div>
									<button class="sf-download-btn" ?disabled=${this._downloadingUid === r.uid} @click=${() => this._onSfDownload(r.uid, r.name)}>
										${this._downloadingUid === r.uid ? "..." : "Download"}
									</button>
								</div>
							`,
									)
					}
					${
						this._sfNextCursor
							? html`
						<div class="sf-load-more" @click=${() => this._doSketchfabSearch(this._sfNextCursor!)}>Load more...</div>
					`
							: ""
					}
				</div>
			</div>

			<div style="margin-top:12px;display:flex;justify-content:flex-end;">
				<button class="back-btn" @click=${this._onModelSourceBack}>
					← Back
				</button>
			</div>
		`;
	}

	private _renderPendingList(): TemplateResult {
		return html`
			${
				this._pendingAssets.length === 0
					? html`<div class="empty-state">No pending assets</div>`
					: this._pendingAssets.map(
							(asset) => html`
					<div class="list-item" @click=${() => this._onPendingSelect(asset)}>
						${svgIcon(["M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"], 16)}
						<div class="list-item-info">
							<div class="list-item-name">${asset.originalName}</div>
							<div class="list-item-meta">${this._formatBytes(asset.size)}</div>
						</div>
						<div class="list-item-actions">
							<button class="icon-btn danger" @click=${(e: Event) => this._onPendingDelete(asset, e)} title="Delete">
								${svgIcon(["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"], 14)}
							</button>
						</div>
					</div>
				`,
						)
			}
		`;
	}
}

customElements.define("start-screen", StartScreen);

declare global {
	interface HTMLElementTagNameMap {
		"start-screen": StartScreen;
	}
}
