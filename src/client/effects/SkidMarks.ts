/**
 * Canvas-based skid mark rendering on the ground surface.
 */

export class SkidMarks {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private texture: HTMLCanvasElement;

	constructor() {
		this.canvas = document.createElement("canvas");
		this.canvas.width = 1024;
		this.canvas.height = 1024;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Failed to get 2d context");
		this.ctx = ctx;
		this.ctx.fillStyle = "rgba(0, 0, 0, 0)";
		this.ctx.fillRect(0, 0, 1024, 1024);
		this.texture = this.canvas;

		// TODO: Create a Three.js texture from this canvas and apply it as a decal on the ground
	}

	/** Add a skid mark at world position */
	addMark(worldX: number, worldZ: number, _width = 0.3): void {
		// TODO: Transform world coordinates to canvas UV coordinates
		const x = ((worldX % 500) + 500) % 500;
		const z = ((worldZ % 500) + 500) % 500;

		this.ctx.fillStyle = "rgba(20, 20, 20, 0.3)";
		this.ctx.beginPath();
		this.ctx.arc((x / 500) * 1024, (z / 500) * 1024, 3, 0, Math.PI * 2);
		this.ctx.fill();
	}

	getTexture(): HTMLCanvasElement {
		return this.texture;
	}

	dispose(): void {
		this.canvas.remove();
	}
}
