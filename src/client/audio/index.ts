/**
 * Audio module — re-exports.
 */

export { AudioBus } from "./AudioBus.ts";
export {
	AE86_SOUND_PROFILE,
	deriveSoundConfig,
	RACE_CAR_SOUND_PROFILE,
	SEDAN_CAR_SOUND_PROFILE,
} from "./audio-profiles.ts";
export {
	type EngineConditions,
	type EngineSoundConfig,
	EXHAUST_SYSTEMS,
	type ExhaustSystemConfig,
	type ExhaustType,
	type HarmonicDef,
	type NoiseConfig,
	type NoiseLayerConfig,
} from "./audio-types.ts";
export { EngineAudio } from "./EngineAudio.ts";
export { SkidAudio } from "./SkidAudio.ts";
export { VehicleAudio } from "./VehicleAudio.ts";
