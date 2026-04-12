/**
 * Client sync — receives car state updates and interpolates remote vehicles.
 */

import type { CarState, NetworkMessage } from "@shared/types.ts";
import type { NetworkManager } from "./NetworkManager.ts";

interface InterpolationEntry {
	states: CarState[];
	lastReceived: number;
}

export class ClientSync {
	/** Buffer of remote car states for interpolation */
	private remoteCars: Map<string, InterpolationEntry> = new Map();

	constructor(private network: NetworkManager) {
		this.network.onMessage(this.handleMessage.bind(this));
	}

	private handleMessage(msg: NetworkMessage): void {
		switch (msg.type) {
			case "carUpdateAll":
				if (msg.cars) {
					for (const [id, state] of Object.entries(msg.cars)) {
						this.updateRemoteCar(id, state as CarState);
					}
				}
				break;
			case "carUpdate":
				if (msg.playerId && msg.data) {
					this.updateRemoteCar(msg.playerId, msg.data as CarState);
				}
				break;
			// TODO: Handle countdownStart, raceStart, raceFinish
		}
	}

	private updateRemoteCar(id: string, state: CarState): void {
		const entry = this.remoteCars.get(id) ?? { states: [], lastReceived: 0 };
		entry.states.push(state);
		entry.lastReceived = Date.now();
		// Keep only recent states
		if (entry.states.length > 10) {
			entry.states.shift();
		}
		this.remoteCars.set(id, entry);
	}

	/** Get interpolated state for a remote car */
	getInterpolatedState(id: string): CarState | null {
		const entry = this.remoteCars.get(id);
		if (!entry || entry.states.length === 0) return null;

		// TODO: Implement proper interpolation between ticks
		return entry.states[entry.states.length - 1];
	}

	/** Send local car state to host */
	sendLocalState(state: CarState): void {
		const message: NetworkMessage = {
			type: "carUpdate",
			playerId: this.network.getPeerId() ?? "unknown",
			data: state,
			timestamp: Date.now(),
		};
		this.network.broadcast(message);
	}

	disconnect(): void {
		this.remoteCars.clear();
	}
}
