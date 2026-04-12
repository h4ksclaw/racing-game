/**
 * Pre-game lobby UI for player setup and multiplayer connection.
 */

import type { LobbyState } from "@shared/types.ts";

export class Lobby {
	/** Show the lobby UI */
	show(state?: Partial<LobbyState>): void {
		// TODO: Build lobby DOM with:
		// - Player name input
		// - Host / Join buttons
		// - Party code input/display
		// - Map selection
		// - Player list
		// - Ready / Start button

		console.log("Lobby shown", state);
	}

	hide(): void {
		// TODO: Remove lobby DOM
	}

	onJoin(cb: (partyCode: string) => void): void {
		// TODO: Store callback for when player joins a party
		void cb;
	}

	onHost(cb: () => void): void {
		// TODO: Store callback for when player hosts a game
		void cb;
	}

	dispose(): void {
		this.hide();
	}
}
