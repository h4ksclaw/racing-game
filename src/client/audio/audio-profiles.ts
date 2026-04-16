/**
 * Engine sound profiles — wired to real car/engine specifications.
 *
 * Sound parameters are DERIVED from engine specs:
 *   - Cylinder count → firing frequency
 *   - Bore/stroke → harmonic distribution
 *   - Aspiration → turbo whine, blow-off
 *
 * To create a new profile: copy the closest existing one,
 * change the engine specs, then tune the harmonic amplitudes.
 */

import type { EngineSoundConfig } from "./audio-types.ts";

function makeSound(
	opts: Partial<EngineSoundConfig> & {
		cylinders: number;
		stroke?: 2 | 4;
		idleRPM: number;
		maxRPM: number;
		revLimiterRPM: number;
	},
): EngineSoundConfig {
	return {
		stroke: 4,
		turbo: false,
		harmonics: [],
		noise: {
			exhaust: { freq: 180, q: 1.5, level: 0.12 },
			intake: { freq: 700, q: 2.5, level: 0.06 },
			mechanical: { freq: 2500, q: 0.8, level: 0.04 },
			valvetrain: { freq: 4000, q: 1.2, level: 0.02 },
		},
		distortion: 30,
		volume: 0.35,
		...opts,
	};
}

/** Toyota AE86 Trueno — 4A-GEU 1.6L DOHC NA Inline-4 */
export const AE86_SOUND_PROFILE: EngineSoundConfig = makeSound({
	cylinders: 4,
	idleRPM: 850,
	maxRPM: 7600,
	revLimiterRPM: 7400,
	harmonics: [
		{ mult: 1, baseAmp: 0.35, rpmScale: [0.4, 1.0], thrScale: [0.3, 1.0], name: "Fundamental" },
		{ mult: 2, baseAmp: 0.28, rpmScale: [0.5, 1.1], thrScale: [0.4, 1.0], name: "H2" },
		{ mult: 3, baseAmp: 0.15, rpmScale: [0.3, 0.8], thrScale: [0.3, 0.9], name: "H3" },
		{ mult: 4, baseAmp: 0.08, rpmScale: [0.2, 0.5], thrScale: [0.2, 0.7], name: "H4" },
		{ mult: 0.5, baseAmp: 0.06, rpmScale: [0.3, 0.6], thrScale: [0.2, 0.5], name: "Sub" },
		{ mult: 1.5, baseAmp: 0.04, rpmScale: [0.2, 0.4], thrScale: [0.1, 0.3], name: "1.5x" },
		{ mult: 6, baseAmp: 0.03, rpmScale: [0.1, 0.3], thrScale: [0.1, 0.4], name: "H6" },
		{ mult: 8, baseAmp: 0.02, rpmScale: [0.05, 0.2], thrScale: [0.05, 0.3], name: "H8" },
	],
	noise: {
		exhaust: { freq: 200, q: 1.2, level: 0.14 },
		intake: { freq: 800, q: 2.0, level: 0.05 },
		mechanical: { freq: 2800, q: 0.7, level: 0.03 },
		valvetrain: { freq: 4500, q: 1.0, level: 0.015 },
	},
	distortion: 25,
	volume: 0.32,
});

/** Generic race car sound profile */
export const RACE_CAR_SOUND_PROFILE: EngineSoundConfig = makeSound({
	cylinders: 4,
	idleRPM: 1000,
	maxRPM: 8500,
	revLimiterRPM: 8300,
	harmonics: [
		{ mult: 1, baseAmp: 0.4, rpmScale: [0.5, 1.0], thrScale: [0.4, 1.0], name: "Fundamental" },
		{ mult: 2, baseAmp: 0.3, rpmScale: [0.6, 1.2], thrScale: [0.5, 1.0], name: "H2" },
		{ mult: 3, baseAmp: 0.12, rpmScale: [0.3, 0.6], thrScale: [0.2, 0.6], name: "H3" },
		{ mult: 4, baseAmp: 0.05, rpmScale: [0.1, 0.3], thrScale: [0.1, 0.3], name: "H4" },
	],
	noise: {
		exhaust: { freq: 250, q: 1.0, level: 0.16 },
		intake: { freq: 900, q: 1.8, level: 0.07 },
		mechanical: { freq: 3000, q: 0.6, level: 0.05 },
		valvetrain: { freq: 5000, q: 0.8, level: 0.025 },
	},
	distortion: 35,
	volume: 0.38,
});

/** Derive a basic sound config from engine specs. */
export function deriveSoundConfig(config: {
	cylinders?: number;
	idleRPM: number;
	maxRPM: number;
	revLimiterRPM?: number;
	turbo?: boolean;
}): EngineSoundConfig {
	const cylinders = config.cylinders ?? 4;
	const revLimiterRPM = config.revLimiterRPM ?? Math.round(config.maxRPM * 0.97);
	return makeSound({
		cylinders,
		idleRPM: config.idleRPM,
		maxRPM: config.maxRPM,
		revLimiterRPM,
		turbo: config.turbo,
		harmonics: [
			{ mult: 1, baseAmp: 0.3, rpmScale: [0.4, 0.9], thrScale: [0.3, 0.9], name: "Fundamental" },
			{ mult: 2, baseAmp: 0.22, rpmScale: [0.4, 0.9], thrScale: [0.3, 0.8], name: "H2" },
			{ mult: 3, baseAmp: 0.1, rpmScale: [0.2, 0.5], thrScale: [0.2, 0.5], name: "H3" },
		],
	});
}

/** Generic sedan sound profile */
export const SEDAN_CAR_SOUND_PROFILE: EngineSoundConfig = makeSound({
	cylinders: 4,
	idleRPM: 800,
	maxRPM: 6500,
	revLimiterRPM: 6300,
	harmonics: [
		{ mult: 1, baseAmp: 0.3, rpmScale: [0.5, 0.8], thrScale: [0.3, 0.8], name: "Fundamental" },
		{ mult: 2, baseAmp: 0.2, rpmScale: [0.4, 0.7], thrScale: [0.3, 0.7], name: "H2" },
		{ mult: 3, baseAmp: 0.08, rpmScale: [0.2, 0.4], thrScale: [0.1, 0.3], name: "H3" },
	],
	noise: {
		exhaust: { freq: 150, q: 1.5, level: 0.08 },
		intake: { freq: 600, q: 2.5, level: 0.03 },
		mechanical: { freq: 2000, q: 1.0, level: 0.02 },
		valvetrain: { freq: 3500, q: 1.5, level: 0.01 },
	},
	distortion: 15,
	volume: 0.25,
});
