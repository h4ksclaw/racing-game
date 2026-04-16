/**
 * VehicleController — thin composition root.
 *
 * Wires together:
 *   VehiclePhysics  → pure math simulation
 *   VehicleRenderer → Three.js model loading and visual sync
 *   EngineAudio     → (optional) procedural engine sound
 *
 * This class is the ONLY thing practice.ts and other consumers interact with.
 * Public API is identical to the previous monolithic VehicleController.
 */

import type { EngineSoundConfig } from "../audio/audio-types.ts";
import type { EngineAudio } from "../audio/EngineAudio.ts";
import type { CarConfig } from "./configs.ts";
import type { TerrainProvider, VehicleInput } from "./types.ts";
import { VehiclePhysics } from "./VehiclePhysics.ts";
import { VehicleRenderer } from "./VehicleRenderer.ts";

export type { RoadBoundaryInfo, TerrainProvider } from "./types.ts";

export class VehicleController {
	readonly physics: VehiclePhysics;
	readonly renderer: VehicleRenderer;
	private _audio: EngineAudio | null = null;

	get audio(): EngineAudio | null {
		return this._audio;
	}

	get state() {
		return this.physics.state;
	}

	get telemetry() {
		return this.physics.telemetry;
	}

	get model() {
		return this.renderer.model;
	}

	get headlights() {
		return this.renderer.headlights;
	}

	get config() {
		return this.physics.config;
	}

	constructor(config: CarConfig) {
		this.physics = new VehiclePhysics(config);
		this.renderer = new VehicleRenderer(config);
	}

	initAudio(profile: EngineSoundConfig): void {
		if (this._audio) return;
		import("../audio/EngineAudio.ts").then(({ EngineAudio: EA }) => {
			this._audio = new EA(profile);
			this._audio.start();
		});
	}

	async loadModel(): Promise<import("three").Group> {
		const model = await this.renderer.loadModel((newConfig) => {
			this.physics.config = newConfig;
			this.physics.rebuildChassis();
		});
		return model;
	}

	setTerrain(terrain: TerrainProvider): void {
		this.physics.setTerrain(terrain);
	}

	update(input: VehicleInput, delta: number): void {
		this.physics.update(input, delta);

		// Feed telemetry to audio
		if (this._audio) {
			this._audio.update(this.physics.telemetry, this.physics.getPosition());
		}
	}

	/** Sync Three.js visuals from physics state. Call once per frame after update(). */
	syncVisuals(): void {
		this.renderer.sync(
			this.physics.getPosition(),
			this.physics.heading,
			this.physics.pitch,
			this.physics.roll,
			this.physics.steerAngle,
			this.physics.state.speed,
			this.renderer.getModelGroundOffset(),
			this.physics.config.chassis.wheelRadius,
		);
	}

	getPosition(): { x: number; y: number; z: number } {
		return this.physics.getPosition();
	}

	getForward(): { x: number; y: number; z: number } {
		return this.physics.getForward();
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.physics.reset(x, y, z, rotation);
	}

	dispose(): void {
		if (this._audio) {
			this._audio.stop();
			this._audio = null;
		}
	}
}
