/**
 * Host relay — collects all car states and broadcasts to clients.
 */

import type { CarState, NetworkMessage } from "@shared/types.ts";
import type { NetworkManager } from "./NetworkManager.ts";

export class HostRelay {
	constructor(private network: NetworkManager) {}

	/** Broadcast all car states to connected clients */
	broadcastCarStates(players: Record<string, CarState>): void {
		const message: NetworkMessage = {
			type: "stateAll",
			players,
		};
		this.network.broadcast(message);
	}

	/** Start the race (countdown → go) */
	startCountdown(): void {
		const message: NetworkMessage = {
			type: "countdown",
			seconds: 3,
		};
		this.network.broadcast(message);

		// TODO: 3-2-1-GO countdown timer, then send raceStart
	}

	startRace(): void {
		const message: NetworkMessage = {
			type: "raceStart",
		};
		this.network.broadcast(message);
	}

	broadcastFinish(results: Array<{ playerId: string; name: string; time: number }>): void {
		const message: NetworkMessage = {
			type: "raceFinish",
			results,
		};
		this.network.broadcast(message);
	}
}
