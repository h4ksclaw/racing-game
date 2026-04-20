/**
 * ForceComputer — engine force and body retard impulse calculations.
 *
 * Extracted from RapierVehicleController.update() to isolate pure
 * force computation from Rapier API calls.
 */

// ── Real-world braking physics ──
const TIRE_MU = 0.85;
const CRR = 0.012;
const MAX_REVERSE_SPEED_MS = 11.0;

export interface EngineParams {
	torqueNm: number;
	finalDrive: number;
	gearRatios: number[];
	maxBrakeG: number;
}

export interface GearboxState {
	effectiveRatio: number;
	isShifting: boolean;
}

export interface EngineState {
	throttle: number;
	rpm: number;
	revLimited: boolean;
	config: { engineBraking: number; maxRPM: number };
	getWheelForce: (ratio: number, wheelRadius: number, tractionPerWheel: number) => number;
	getTorqueMultiplier: () => number;
}

export interface DragConfig {
	aeroDrag: number;
}

export interface ChassisParams {
	mass: number;
	wheelRadius: number;
}

export interface ForceInput {
	dsIsBraking: boolean;
	dsIsReverse: boolean;
	dsNeutral: boolean;
	absSpeedMs: number;
	localVelX: number;
	heading: number;
	handbrake: boolean;
	wantsForward: boolean;
	tractionPerWheel: number;
}

export interface ForceResult {
	engF: number;
	rapierBrakeForce: number;
	totalRetard: number;
	isHandbrake: boolean;
	coastBodyBrakeN: number;
	brakeBodyN: number;
	debugRolling: number;
	debugAero: number;
	debugEngineBrake: number;
	retardFx: number;
	retardFz: number;
	forcesDebug: {
		brake: number;
		wheelBrake: number;
		rolling: number;
		aero: number;
		engineBrake: number;
		coast: number;
	};
}

export function computeForces(
	input: ForceInput,
	engine: EngineState,
	gearbox: GearboxState,
	engineSpec: EngineParams,
	chassis: ChassisParams,
	drag: DragConfig,
	dt: number,
): ForceResult {
	const {
		dsIsBraking: isBraking,
		dsIsReverse: isReverse,
		dsNeutral,
		absSpeedMs,
		localVelX,
		heading,
		handbrake,
		wantsForward,
		tractionPerWheel,
	} = input;
	let rapierBrakeForce = 0;
	let coastBodyBrakeN = 0;
	let brakeBodyN = 0;

	if (isBraking) {
		rapierBrakeForce = 5.0;

		const absKmh = 5;
		const baseMu = engineSpec.maxBrakeG;
		const loadSensitivityFactor = 0.95;

		const speedKmh = Math.abs(localVelX) * 3.6;
		const lowSpeedFactor = speedKmh < absKmh ? 0.6 + 0.4 * (speedKmh / absKmh) : 1.0;
		const highSpeedFactor = speedKmh > 100 ? 1.0 + 0.1 * Math.min(1.0, (speedKmh - 100) / 100) : 1.0;

		brakeBodyN = baseMu * loadSensitivityFactor * lowSpeedFactor * highSpeedFactor * chassis.mass * 9.81;
	} else if (dsNeutral && Math.abs(localVelX) > 0.1) {
		const speedFactor = Math.min(1.0, Math.abs(localVelX) / 5.0);
		coastBodyBrakeN = 0.03 * chassis.mass * 9.81 * speedFactor;
	}

	// Engine force
	let engF = 0;
	if (!handbrake && wantsForward) {
		engF = engine.getWheelForce(gearbox.effectiveRatio, chassis.wheelRadius, tractionPerWheel);
		if (gearbox.isShifting) engF *= 0.3;
	} else if (isReverse) {
		const firstGearRatio = engineSpec.gearRatios[0] || 3.5;
		const reverseRatio = engineSpec.finalDrive * firstGearRatio;
		engF = -(engineSpec.torqueNm * 0.45 * reverseRatio * engine.getTorqueMultiplier()) / chassis.wheelRadius;
		engF = Math.max(engF, -tractionPerWheel * 1.5);
	}

	// Drag forces
	let totalRetard = 0;
	let debugRolling = 0;
	let debugAero = 0;
	let debugEngineBrake = 0;

	if (isReverse) {
		debugRolling = CRR * chassis.mass * 9.81 * 0.5;
		debugAero = drag.aeroDrag * absSpeedMs * absSpeedMs;
		if (absSpeedMs > MAX_REVERSE_SPEED_MS) {
			const overshoot = absSpeedMs - MAX_REVERSE_SPEED_MS;
			totalRetard = TIRE_MU * chassis.mass * 9.81 * 5 * overshoot;
		} else {
			totalRetard = debugRolling + debugAero;
		}
	} else {
		debugRolling = CRR * chassis.mass * 9.81 * 0.5;
		debugAero = drag.aeroDrag * localVelX * localVelX;
		debugEngineBrake =
			localVelX > 0.1
				? (engine.config.engineBraking *
						engineSpec.torqueNm *
						gearbox.effectiveRatio *
						(engine.rpm / engine.config.maxRPM)) /
					chassis.wheelRadius
				: 0;
		totalRetard = debugEngineBrake + debugRolling + debugAero + coastBodyBrakeN + brakeBodyN;
		totalRetard = Math.min(totalRetard, TIRE_MU * chassis.mass * 9.81);
		if (handbrake && !isBraking) {
			const hSpeedKmh = absSpeedMs * 3.6;
			const hBrakeG = hSpeedKmh < 5 ? 0.5 + 0.4 * (hSpeedKmh / 5) : 0.9;
			totalRetard += hBrakeG * chassis.mass * 9.81;
			totalRetard = Math.min(totalRetard, TIRE_MU * chassis.mass * 9.81 * 1.2);
		}
	}

	let retardFx = 0;
	let retardFz = 0;
	if (totalRetard > 0 && absSpeedMs > 0.01) {
		retardFx = -totalRetard * Math.sin(heading) * Math.sign(localVelX) * dt;
		retardFz = -totalRetard * Math.cos(heading) * Math.sign(localVelX) * dt;
	}

	const retardSign = localVelX >= 0 ? -1 : 1;
	const forcesDebug = {
		brake: brakeBodyN * retardSign,
		wheelBrake: rapierBrakeForce > 0 ? rapierBrakeForce * 500 * retardSign : 0,
		rolling: debugRolling * retardSign,
		aero: debugAero * retardSign,
		engineBrake: debugEngineBrake * retardSign,
		coast: coastBodyBrakeN * retardSign,
	};

	return {
		engF,
		rapierBrakeForce,
		totalRetard,
		isHandbrake: !!handbrake,
		coastBodyBrakeN,
		brakeBodyN,
		debugRolling,
		debugAero,
		debugEngineBrake,
		retardFx,
		retardFz,
		forcesDebug,
	};
}
