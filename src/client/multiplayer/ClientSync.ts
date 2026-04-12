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
			case "stateAll":
				for (const [id, state] of Object.entries(msg.players)) {
					this.updateRemoteCar(id, state);
				}
				break;
			case "state":
				this.updateRemoteCar(msg.playerId, msg.car);
				break;
			case "countdown":
			case "raceStart":
			case "raceFinish":
				// TODO: Handle race events
				break;
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
			type: "state",
			playerId: this.network.getPeerId() ?? "unknown",
			car: state,
		};
		this.network.send(this.network.getPeerId() ?? "unknown", message);
	}

	disconnect(): void {
		this.remoteCars.clear();
	}
}
