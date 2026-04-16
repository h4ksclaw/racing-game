/**
 * Audio type definitions for procedural engine sound synthesis.
 *
 * These types define the interface between engine specs and audio output.
 * EngineAudio consumes these; physics/telemetry feeds them.
 */

/** Harmonic oscillator definition — one sine wave in the additive engine sound. */
export interface HarmonicDef {
	/** Frequency multiplier relative to firing fundamental */
	readonly mult: number;
	/** Base amplitude (0-1) at idle */
	readonly baseAmp: number;
	/** Amplitude scale at [idle RPM, max RPM] — linearly interpolated */
	readonly rpmScale: readonly [number, number];
	/** Amplitude scale at [0% throttle, 100% throttle] — linearly interpolated */
	readonly thrScale: readonly [number, number];
	/** Human-readable label */
	readonly name?: string;
}

/** Bandpass noise layer configuration. */
export interface NoiseLayerConfig {
	/** Bandpass center frequency at idle (Hz) */
	readonly freq: number;
	/** Bandpass Q factor */
	readonly q: number;
	/** Base level (0-1) */
	readonly level: number;
}

/** All four noise layers. */
export interface NoiseConfig {
	readonly exhaust: NoiseLayerConfig;
	readonly intake: NoiseLayerConfig;
	readonly mechanical: NoiseLayerConfig;
	readonly valvetrain: NoiseLayerConfig;
}

/** Exhaust system types. */
export type ExhaustType = "stock" | "sport" | "straight" | "race";

/** Exhaust system parameters that shape the sound. */
export interface ExhaustSystemConfig {
	readonly flowRestriction: number;
	readonly resonance: number;
	readonly volumeMultiplier: number;
	readonly highFreqDamp: number;
}

/** Engine conditions that affect sound behavior. */
export interface EngineConditions {
	load?: number;
	boost?: number;
	exhaust?: ExhaustType;
	misfire?: boolean;
	backfire?: boolean;
	knock?: boolean;
	valveFloat?: boolean;
	wastegate?: boolean;
	oilTemp?: number;
	revLimiter?: boolean;
}

/** Full engine sound configuration — wired to an engine profile. */
export interface EngineSoundConfig {
	readonly cylinders: number;
	readonly stroke: 2 | 4;
	readonly idleRPM: number;
	readonly maxRPM: number;
	readonly revLimiterRPM: number;
	readonly harmonics: readonly HarmonicDef[];
	readonly noise: NoiseConfig;
	readonly distortion: number;
	readonly volume: number;
	readonly turbo?: boolean;
	/** Turbo compressor whistle base frequency (Hz) */
	readonly turboBaseFreq?: number;
	/** Turbo compressor whistle max frequency (Hz) */
	readonly turboMaxFreq?: number;
}

/** Exhaust system presets. */
export const EXHAUST_SYSTEMS: Record<ExhaustType, ExhaustSystemConfig> = {
	stock: {
		flowRestriction: 0.3,
		resonance: 0.6,
		volumeMultiplier: 0.7,
		highFreqDamp: 0.5,
	},
	sport: {
		flowRestriction: 0.15,
		resonance: 0.3,
		volumeMultiplier: 0.9,
		highFreqDamp: 0.3,
	},
	straight: {
		flowRestriction: 0.02,
		resonance: 0.0,
		volumeMultiplier: 1.3,
		highFreqDamp: 0.1,
	},
	race: {
		flowRestriction: 0.05,
		resonance: 0.1,
		volumeMultiplier: 1.1,
		highFreqDamp: 0.2,
	},
};
