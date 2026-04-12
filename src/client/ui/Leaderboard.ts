/**
 * Race standings leaderboard overlay.
 */

import type { PlayerInfo } from "@shared/types.ts";

export class Leaderboard {
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: stub — will be used when implemented
	private container: HTMLElement;

	constructor(container: HTMLElement) {
		this.container = container;
	}

	/** Update the leaderboard display */
	update(players: PlayerInfo[], finishOrder: string[]): void {
		// TODO: Render leaderboard overlay showing:
		// - Player position
		// - Player name
		// - Finish time
		console.log("Leaderboard update", players, finishOrder);
	}

	show(): void {
		// TODO: Show overlay
	}

	hide(): void {
		// TODO: Hide overlay
	}

	dispose(): void {
		this.hide();
	}
}
