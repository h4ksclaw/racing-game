/**
 * VehicleAudio — composes engine + skid audio into a single update point.
 *
 * WHY: practice.ts shouldn't manage individual audio instances. This class
 * owns the full vehicle soundscape — engine RPM, tire skid, and spatial
 * listener — so the game loop just calls vehicleAudio.update() once per frame.
 *
 * Usage:
 *   const audio = new VehicleAudio(soundConfig);
 *   audio.start();
 *   // In animate():
 *   audio.update(telemetry, pos, forward, driftFactor);
 *   audio.dispose();
 */

import type { EngineTelemetry } from "../vehicle/types.ts";
import { AudioBus } from "./AudioBus.ts";
import type { EngineSoundConfig } from "./audio-types.ts";
import { EngineAudio } from "./EngineAudio.ts";
import { SkidAudio } from "./SkidAudio.ts";

export class VehicleAudio {
	private engine: EngineAudio;
	private skid: SkidAudio;
	private bus: AudioBus;

	constructor(soundConfig: EngineSoundConfig) {
		this.bus = AudioBus.getInstance();
		this.engine = new EngineAudio(soundConfig);
		this.skid = new SkidAudio(this.bus);
	}

	/** Build the audio graph and start playback. Call once after user gesture. */
	start(): void {
		this.bus.acquire();
		this.engine.start();
	}

	/**
	 * Update all vehicle audio for this frame.
	 *
	 * @param telemetry - Engine state (RPM, throttle, load, etc.)
	 * @param pos - Vehicle world position for spatial audio
	 * @param forward - Vehicle forward direction for listener orientation
	 * @param driftFactor - 0-1, how hard the tires are sliding (controls skid volume)
	 */
	update(
		telemetry: EngineTelemetry,
		pos: { x: number; y: number; z: number },
		forward: { x: number; y: number; z: number },
		driftFactor = 0,
	): void {
		this.engine.update(telemetry, pos);
		this.bus.updateListener(pos, forward);
		this.skid.update(driftFactor);
	}

	/** Get the engine analyser for visualization (waveform/spectrum). */
	getAnalyser(): AnalyserNode | null {
		return this.engine.getAnalyser();
	}

	/** Tear down all audio nodes. */
	dispose(): void {
		this.engine.stop();
		this.skid.dispose();
	}
}
