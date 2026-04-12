/**
 * Host relay — collects all car states and broadcasts to clients.
 */

import type { CarState, NetworkMessage } from "@shared/types.ts";
import type { NetworkManager } from "./NetworkManager.ts";

export class HostRelay {
	constructor(private network: NetworkManager) {}

	/** Broadcast all car states to connected clients */
	broadcastCarStates(cars: Record<string, CarState>): void {
		const message: NetworkMessage = {
			type: "carUpdateAll",
			playerId: "host",
			cars,
			timestamp: Date.now(),
		};
		this.network.broadcast(message);
	}

	/** Start the race (countdown → go) */
	startCountdown(): void {
		const message: NetworkMessage = {
			type: "countdownStart",
			playerId: "host",
			timestamp: Date.now(),
		};
		this.network.broadcast(message);

		// TODO: 3-2-1-GO countdown timer, then send raceStart
	}

	startRace(): void {
		const message: NetworkMessage = {
			type: "raceStart",
			playerId: "host",
			timestamp: Date.now(),
		};
		this.network.broadcast(message);
	}

	broadcastFinish(playerId: string): void {
		const message: NetworkMessage = {
			type: "raceFinish",
			playerId,
			timestamp: Date.now(),
		};
		this.network.broadcast(message);
	}
}
