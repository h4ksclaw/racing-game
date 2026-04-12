export interface CarState {
	position: { x: number; y: number; z: number };
	quaternion: { x: number; y: number; z: number; w: number };
	velocity: { x: number; y: number; z: number };
	speed: number;
	steerAngle: number;
}

export interface NetworkMessage {
	type: "carUpdate" | "carUpdateAll" | "countdownStart" | "raceStart" | "raceFinish";
	playerId: string;
	data?: Partial<CarState>;
	cars?: Record<string, Partial<CarState>>;
	timestamp: number;
}

export interface PlayerInfo {
	id: string;
	name: string;
	color: string;
	isHost: boolean;
}

export interface LobbyState {
	partyCode: string;
	players: PlayerInfo[];
	selectedMap: string;
	hostId: string;
}

export type ControlState = {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	handbrake: boolean;
	reset: boolean;
};

export interface DriftState {
	active: boolean;
	angle: number;
	duration: number;
	score: number;
}
