/**
 * HUD overlay — speed, position, minimap.
 */

export interface HUDState {
	speed: number;
	position: number;
	totalPlayers: number;
}

export class HUD {
	private speedEl: HTMLElement;
	private positionEl: HTMLElement;

	constructor(container: HTMLElement) {
		// Create HUD DOM
		const hud = document.createElement("div");
		hud.id = "hud";
		hud.style.cssText =
			"position:absolute;bottom:20px;left:20px;color:#fff;font-family:monospace;font-size:1.2rem;text-shadow:0 0 4px #000;pointer-events:none;";

		this.speedEl = document.createElement("div");
		this.speedEl.id = "hud-speed";
		this.speedEl.textContent = "0 km/h";

		this.positionEl = document.createElement("div");
		this.positionEl.id = "hud-position";
		this.positionEl.textContent = "P1 / 1";

		hud.append(this.speedEl, this.positionEl);
		container.appendChild(hud);
	}

	update(state: HUDState): void {
		this.speedEl.textContent = `${state.speed} km/h`;
		this.positionEl.textContent = `P${state.position} / ${state.totalPlayers}`;
	}

	dispose(): void {
		this.speedEl.remove();
		this.positionEl.remove();
	}
}
