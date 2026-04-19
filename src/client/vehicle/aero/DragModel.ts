/**
 * DragModel — rolling resistance + aerodynamic drag.
 *
 * Pure simulation module. No side effects.
 */

import type { DragSpec } from "../configs.ts";

export interface DragConfig extends DragSpec {}

export class DragModel {
	readonly config: DragConfig;

	constructor(config: DragConfig) {
		this.config = config;
	}

	/** Get drag force (N). Always opposes motion. */
	getForce(speed: number): number {
		return this.config.rollingResistance * speed + this.config.aeroDrag * speed * speed;
	}
}
