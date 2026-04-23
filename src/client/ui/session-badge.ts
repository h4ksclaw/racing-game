import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class SessionBadge extends LitElement {
	static override styles = [
		themeStyles,
		css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 100;
        pointer-events: none;
        font-family: var(--ui-sans);
        background: var(--ui-panel);
        backdrop-filter: blur(10px);
        border: var(--ui-border);
        padding: 6px 14px;
      }
      .dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--ui-accent);
        animation: pulse 2s infinite;
      }
      .type {
        font-size: 9px;
        color: rgba(92, 158, 255, 0.3);
        font-weight: 600;
        letter-spacing: 1px;
      }
      .timer {
        font-size: 13px;
        color: var(--ui-text-bright);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        font-family: var(--ui-mono);
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }
    `,
	];

	declare type: string;
	declare elapsed: number;

	constructor() {
		super();
		this.type = "";
		this.elapsed = 0;
	}

	static override properties = {
		type: { type: String },
		elapsed: { type: Number },
	};

	private formatTime(s: number): string {
		const hrs = String(Math.floor(s / 3600)).padStart(2, "0");
		const mins = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
		const secs = String(Math.floor(s % 60)).padStart(2, "0");
		return `${hrs}:${mins}:${secs}`;
	}

	override render() {
		return html`
      <div class="dot"></div>
      <span class="type">${this.type}</span>
      <span class="timer">${this.formatTime(this.elapsed)}</span>
    `;
	}
}
customElements.define("session-badge", SessionBadge);

declare global {
	interface HTMLElementTagNameMap {
		"session-badge": SessionBadge;
	}
}
