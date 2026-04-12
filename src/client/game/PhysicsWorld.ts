/**
 * cannon-es physics world wrapper.
 */

import { SAPBroadphase, World } from "cannon-es";

export class PhysicsWorld {
	readonly world: World;

	constructor(gravity: number) {
		this.world = new World();
		this.world.gravity.set(0, gravity, 0);
		this.world.broadphase = new SAPBroadphase(this.world);
		(this.world.solver as unknown as { iterations: number }).iterations = 10;

		// TODO: add contact material for tires vs ground
	}

	/** Step the physics simulation */
	step(delta: number): void {
		this.world.step(1 / 60, delta, 3);
	}

	dispose(): void {
		// cannon-es doesn't have a clear method; remove bodies manually
		for (let i = this.world.bodies.length - 1; i >= 0; i--) {
			this.world.removeBody(this.world.bodies[i]);
		}
	}
}
