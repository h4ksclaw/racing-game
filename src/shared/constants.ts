// Tuned from driftking + circuit-rush analysis
export const PHYSICS = {
	GRAVITY: -20,
	CHASSIS_MASS: 150,
	CHASSIS_HALF_EXTENTS: { x: 0.9, y: 0.3, z: 2.0 },
	WHEEL_RADIUS: 0.35,
	WHEEL_WIDTH: 0.3,
	WHEEL_POSITIONS: [
		{ x: -0.8, y: -0.3, z: 1.2 } as const, // front-left
		{ x: 0.8, y: -0.3, z: 1.2 } as const, // front-right
		{ x: -0.8, y: -0.3, z: -1.0 } as const, // rear-left
		{ x: 0.8, y: -0.3, z: -1.0 } as const, // rear-right
	],
	MAX_STEER: 0.5,
	MAX_ENGINE_FORCE: 1200,
	MAX_BRAKE_FORCE: 100,
	FRICTION_SLIP_NORMAL: 5,
	FRICTION_SLIP_DRIFT: 0.5,
	SUSPENSION_STIFFNESS: 30,
	SUSPENSION_REST_LENGTH: 0.3,
	DAMPING_RELAXATION: 2.3,
	DAMPING_COMPRESSION: 4.4,
	MAX_SUSPENSION_FORCE: 100000,
	ROLL_INFLUENCE: 0.01,
	MAX_SUSPENSION_TRAVEL: 0.3,
	PHYSICS_STEP: 1 / 60,
	PHYSICS_SUBSTEPS: 3,
} as const;

export const CAMERA = {
	DISTANCE: 10,
	HEIGHT: 5,
	LERP: 0.1,
	LOOK_AHEAD: 2,
} as const;

export const NETWORK = {
	TICK_RATE: 30, // Hz
	INTERPOLATION_DELAY: 2, // ticks behind
	MAX_PLAYERS: 8,
	CONNECTION_TIMEOUT: 15000,
	RETRY_COUNT: 15,
	RETRY_DELAY: 2000,
} as const;

export const DRIFT = {
	MIN_SPEED: 5,
	MIN_ANGLE: 0.3,
	SCORE_MULTIPLIER: 10,
} as const;

export const STEERING = {
	MAX_ANGLE: 0.5, // radians at 0 km/h
	MIN_ANGLE: 0.15, // radians at high speed
	MAX_SPEED: 150, // km/h where min angle kicks in
} as const;
