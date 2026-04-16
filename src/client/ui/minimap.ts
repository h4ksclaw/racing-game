import { css, html, LitElement } from "lit";
import { themeStyles } from "./theme.ts";

export class RaceMinimap extends LitElement {
	static override styles = [
		themeStyles,
		css`
			:host {
				position: fixed;
				top: 36px;
				right: 16px;
				z-index: 100;
				pointer-events: none;
				background: var(--ui-panel);
				backdrop-filter: blur(10px);
				border: var(--ui-border);
				padding: 6px;
				width: 120px;
			}
			canvas {
				width: 100%;
				height: 100%;
				border-radius: 2px;
				background: rgba(92,158,255,0.03);
			}
			.coords {
				margin-top: 4px;
				font-family: var(--ui-mono);
				font-size: 8px;
				color: rgba(92,158,255,0.2);
				letter-spacing: 1px;
				text-align: center;
			}
		`,
	];

	declare playerX: number;
	declare playerZ: number;
	declare heading: number;
	declare speed: number;

	private _canvas: HTMLCanvasElement | undefined;

	constructor() {
		super();
		this.playerX = 0;
		this.playerZ = 0;
		this.heading = 0;
		this.speed = 0;
	}

	static override properties = {
		playerX: { type: Number },
		playerZ: { type: Number },
		heading: { type: Number },
		speed: { type: Number },
	};

	override firstUpdated(): void {
		this._canvas = this.shadowRoot?.querySelector("canvas") ?? undefined;
		this.draw();
	}

	override updated(): void {
		this.draw();
	}

	private draw(): void {
		const c = this._canvas;
		if (!c) return;
		const w = 108;
		const h = 108;
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, w, h);

		// Road path
		ctx.strokeStyle = "rgba(92,158,255,0.15)";
		ctx.lineWidth = 4;
		ctx.beginPath();
		for (let x = 0; x <= w; x += 2) {
			const y = h / 2 + Math.sin((x + this.playerX * 0.3) * 0.06) * 25;
			if (x === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Player arrow
		const dotX = w / 2;
		const dotY = h / 2;
		ctx.save();
		ctx.translate(dotX, dotY);
		ctx.rotate(this.heading);
		ctx.fillStyle = "rgba(92,158,255,1)";
		ctx.shadowColor = "rgba(92,158,255,0.6)";
		ctx.shadowBlur = 6;
		ctx.beginPath();
		ctx.moveTo(0, -5);
		ctx.lineTo(3, 4);
		ctx.lineTo(-3, 4);
		ctx.closePath();
		ctx.fill();
		ctx.restore();

		// Speed ring
		const ringRadius = 20 + (this.speed / 200) * 30;
		ctx.strokeStyle = `rgba(92,158,255,${0.05 + (this.speed / 200) * 0.1})`;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(dotX, dotY, ringRadius, 0, Math.PI * 2);
		ctx.stroke();
	}

	override render() {
		return html`
			<canvas></canvas>
			<div class="coords">X:${this.playerX.toFixed(0)} Z:${this.playerZ.toFixed(0)}</div>
		`;
	}
}
customElements.define("race-minimap", RaceMinimap);
