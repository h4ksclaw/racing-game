/**
 * DriveState — drive state machine for forward/reverse/brake/neutral.
 *
 * WHY: A single S key must serve double duty — brake when moving forward,
 * reverse when slow/stopped. Without hysteresis the car would flicker between
 * braking and reversing at the transition speed.
 */

const BRAKE_HYSTERESIS = 0.15; // m/s — above this while holding S = braking

export interface DriveStateResult {
	wantsForward: boolean;
	wantsBackward: boolean;
	isBraking: boolean;
	isReverse: boolean;
	effectiveNeutral: boolean;
}

export class DriveState {
	private prevReverse = false;

	compute(wantsForward: boolean, wantsBackward: boolean, localVelX: number): DriveStateResult {
		let isBraking = false;
		let isReverse = false;
		const wantsNeutral = !wantsForward && !wantsBackward;

		if (wantsBackward) {
			if (localVelX > BRAKE_HYSTERESIS && !this.prevReverse) {
				isBraking = true;
			} else {
				isReverse = true;
			}
		}
		// Already moving backward? Always treat S as reverse, never brake
		if (wantsBackward && localVelX < -0.3) {
			isBraking = false;
			isReverse = true;
		}

		this.prevReverse = isReverse;
		return { wantsForward, wantsBackward, isBraking, isReverse, effectiveNeutral: wantsNeutral };
	}
}
