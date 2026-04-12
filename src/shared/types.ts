/** Kinematic state of a car — used for physics sync and network broadcast */
export interface CarState {
	position: { x: number; y: number; z: number };
	quaternion: { x: number; y: number; z: number; w: number };
	velocity: { x: number; y: number; z: number };
	speed: number; // km/h
	steerAngle: number;
	raceProgress: RaceProgress;
}

/** Checkpoint progress — determines race position */
export interface RaceProgress {
	gateIndex: number; // current target gate
	distanceToNextGate: number; // distance to that gate
	lap: number; // current lap (0-indexed)
}

/** Network messages sent between peers */
export type NetworkMessage =
	| { type: "state"; playerId: string; car: CarState }
	| { type: "stateAll"; players: Record<string, CarState> }
	| { type: "countdown"; seconds: number }
	| { type: "raceStart" }
	| { type: "raceFinish"; results: Array<{ playerId: string; name: string; time: number }> }
	| { type: "playerJoined"; playerId: string; name: string; color: string }
	| { type: "playerLeft"; playerId: string }
	| { type: "ready"; playerId: string };

/** Player info for lobby */
export interface PlayerInfo {
	id: string;
	name: string;
	color: string;
	isHost: boolean;
}

/** Lobby state managed by Express server */
export interface LobbyState {
	partyCode: string;
	players: PlayerInfo[];
	selectedMap: string;
	hostId: string;
}

/** Input state — raw keypresses before physics mapping */
export type ControlState = {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	handbrake: boolean;
	reset: boolean;
};

/** Drift detection state */
export interface DriftState {
	active: boolean;
	angle: number; // radians between heading and velocity
	duration: number; // seconds in current drift
	score: number; // accumulated drift points
	multiplier: number; // combo multiplier (resets on drift end)
}
