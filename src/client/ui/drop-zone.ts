/**
 * DropZone — file drop/upload area for GLB models.
 */
import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class DropZone extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: block;
      }
      .zone {
        border: 1px dashed var(--ui-accent-faint);
        border-radius: 4px;
        padding: 18px;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s;
        color: var(--ui-text-bright);
      }
      .zone:hover,
      .zone.drag-over {
        border-color: var(--ui-accent-dim);
        background: var(--ui-accent-ghost);
        color: var(--ui-accent);
      }
      .zone.loading {
        opacity: 0.5;
        pointer-events: none;
      }
      input {
        display: none;
      }
    `,
	];

	override render() {
		return html`
      <div
        class="zone"
        @click=${this._onClick}
        @dragover=${this._onDragOver}
        @dragleave=${this._onDragLeave}
        @drop=${this._onDrop}
      >
        <div>Drop GLB here or click to browse</div>
        <input type="file" accept=".glb,.gltf" @change=${this._onFileChange} />
      </div>
    `;
	}

	private _onClick() {
		this.renderRoot.querySelector<HTMLInputElement>("input")?.click();
	}

	private _onDragOver(e: DragEvent) {
		e.preventDefault();
		this.renderRoot.querySelector(".zone")?.classList.add("drag-over");
	}

	private _onDragLeave() {
		this.renderRoot.querySelector(".zone")?.classList.remove("drag-over");
	}

	private _onDrop(e: DragEvent) {
		e.preventDefault();
		this.renderRoot.querySelector(".zone")?.classList.remove("drag-over");
		const file = e.dataTransfer?.files[0];
		if (file) this._emit(file);
	}

	private _onFileChange() {
		const input = this.renderRoot.querySelector<HTMLInputElement>("input");
		if (input?.files?.[0]) this._emit(input.files[0]);
	}

	/** Show loading state — disables the zone while uploading. */
	setLoading(loading: boolean) {
		const zone = this.renderRoot.querySelector(".zone");
		if (zone) zone.classList.toggle("loading", loading);
	}

	private _emit(file: File) {
		this.dispatchEvent(
			new CustomEvent("file-drop", {
				detail: file,
				bubbles: true,
				composed: true,
			}),
		);
	}
}
customElements.define("drop-zone", DropZone);

declare global {
	interface HTMLElementTagNameMap {
		"drop-zone": DropZone;
	}
}
