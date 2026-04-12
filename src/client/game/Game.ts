/**
 * Main Game orchestrator.
 * Owns the game loop, coordinates all subsystems.
 */

import { PHYSICS } from "@shared/constants.ts";
import type { ControlState } from "@shared/types.ts";
import { HUD } from "../ui/HUD.ts";
import { Vehicle } from "../vehicle/Vehicle.ts";
import { VehicleCamera } from "../vehicle/VehicleCamera.ts";
import { VehicleControls } from "../vehicle/VehicleControls.ts";
import { InputManager } from "./InputManager.ts";
import { PhysicsWorld } from "./PhysicsWorld.ts";
import { SceneManager } from "./SceneManager.ts";

export class Game {
	private sceneManager: SceneManager;
	private physicsWorld: PhysicsWorld;
	private inputManager: InputManager;
	private vehicle: Vehicle;
	private vehicleControls: VehicleControls;
	private vehicleCamera: VehicleCamera;
	private hud: HUD;

	private animationFrameId: number | null = null;
	private lastTime = 0;
	private running = false;

	constructor(container: HTMLElement) {
		this.sceneManager = new SceneManager(container);
		this.physicsWorld = new PhysicsWorld(PHYSICS.GRAVITY);
		this.inputManager = new InputManager();

		// TODO: Load vehicle model from GLB
		this.vehicle = new Vehicle(this.physicsWorld, {
			mass: PHYSICS.CHASSIS_MASS,
			position: { x: 0, y: 2, z: 0 },
		});

		this.vehicleControls = new VehicleControls(this.vehicle, this.inputManager);
		this.vehicleCamera = new VehicleCamera(this.sceneManager.getCamera(), this.vehicle);
		this.hud = new HUD(container);
	}

	/** Initialize and start the game */
	init(): void {
		this.sceneManager.add(this.vehicle.getMesh());
		this.sceneManager.addDefaultLights();
		this.sceneManager.addGround();
		this.inputManager.listen();
		this.running = true;
		this.lastTime = performance.now();
		this.loop();
	}

	/** Main game loop */
	private loop = (): void => {
		if (!this.running) return;

		const now = performance.now();
		const delta = Math.min((now - this.lastTime) / 1000, 0.05); // cap at 50ms
		this.lastTime = now;

		this.update(delta);
		this.render();

		this.animationFrameId = requestAnimationFrame(this.loop);
	};

	/** Update all systems */
	private update(delta: number): void {
		const controls: ControlState = this.inputManager.getState();
		this.vehicleControls.apply(controls, delta);
		this.physicsWorld.step(delta);
		this.vehicle.syncMesh();
		this.vehicleCamera.update(delta);
		this.hud.update({
			speed: this.vehicle.getSpeed(),
			position: 1,
			totalPlayers: 1,
		});
	}

	/** Render the scene */
	private render(): void {
		this.sceneManager.render();
	}

	/** Stop the game loop */
	dispose(): void {
		this.running = false;
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
		}
		this.inputManager.dispose();
		this.sceneManager.dispose();
		this.physicsWorld.dispose();
	}
}
