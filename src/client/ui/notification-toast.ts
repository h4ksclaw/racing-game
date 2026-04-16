import { css, html, LitElement } from "lit";

export class NotificationToast extends LitElement {
	static styles = css`
		:host {
			position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
			z-index: 300; font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
			pointer-events: none; opacity: 0; transition: opacity 0.3s ease;
		}
		:host([visible]) { opacity: 1; }
		.toast {
			background: rgba(14,16,24,0.9); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
			border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
			padding: 14px 24px; font-size: 14px; font-weight: 500; color: #f0f2f5; text-align: center; white-space: nowrap;
		}
		.toast.success { border-color: rgba(0,229,160,0.3); }
		.toast.warning { border-color: rgba(255,107,53,0.3); }
		.toast.error { border-color: rgba(255,51,85,0.3); }
		.toast.info { border-color: rgba(100,160,255,0.3); }
		.icon { margin-right: 8px; }
	`;

	static properties = {
		message: { type: String },
		type: { type: String },
		visible: { type: Boolean, reflect: true },
		duration: { type: Number },
	};

	declare message: string;
	declare type: string;
	declare visible: boolean;
	declare duration: number;

	private _timer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super();
		this.message = "";
		this.type = "info";
		this.visible = false;
		this.duration = 2000;
	}

	updated() {
		if (this.visible) {
			if (this._timer) clearTimeout(this._timer);
			if (this.duration > 0)
				this._timer = setTimeout(() => {
					this.visible = false;
				}, this.duration);
		}
	}

	render() {
		const icons: Record<string, string> = { success: "✓", warning: "⚠", error: "✕", info: "ℹ" };
		return html`<div class="toast ${this.type}"><span class="icon">${icons[this.type] || "ℹ"}</span>${this.message}</div>`;
	}

	show(message?: string, duration?: number) {
		if (message !== undefined) this.message = message;
		if (duration !== undefined) this.duration = duration;
		this.visible = true;
	}

	hide() {
		this.visible = false;
		if (this._timer) clearTimeout(this._timer);
	}
}

customElements.define("notification-toast", NotificationToast);
