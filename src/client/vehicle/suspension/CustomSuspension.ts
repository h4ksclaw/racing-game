/**
 * CustomSuspension — differential forces for realistic body pitch and roll.
 *
 * PROBLEM: Rapier's DynamicRayCastVehicleController applies suspension forces
 * as direct velocity modifications — no differential loading, no weight transfer,
 * no body pitch/roll from suspension. All wheels compress identically.
 *
 * SOLUTION: Read Rapier's per-wheel suspension compression and apply ONLY the
 * DIFFERENTIAL component as impulses at the wheel anchor points. The average
 * (baseline) support is left entirely to Rapier — we only add/remove force where
 * wheels differ from the mean.
 *
 * WHY differential only: Rapier already holds the car at the correct ride height.
 * Adding full spring forces on top would double the support, push the car up,
 * cause oscillation, or fight Rapier's solver. By only applying differences,
 * we create torque (pitch/roll moments) without changing the net vertical force.
 *
 * DESIGN:
 *   - Compute average compression across all grounded wheels
 *   - For each wheel: F = k × (compression - average) + c × velocity
 *   - This is analogous to an anti-roll bar: resists differential compression
 *   - Net vertical force sums to zero → no ride height change
 *   - Differential forces create torque → body pitches under braking, rolls in corners
 *
 * MATH:
 *   avg_comp = mean(compression_i) for all grounded wheels
 *   F_i = k × (comp_i - avg_comp) + c × (vel_i - avg_vel)
 *   sum(F_i) = 0 always (Newton's 3rd law for vertical forces)
 *   Torque = sum(F_i × r_i) where r_i is wheel offset from center of mass
 */

import type RAPIER from "@dimforge/rapier3d-compat";

export interface CustomSuspensionConfig {
	/** Differential spring rate (N/m). Controls how strongly the body resists differential compression.
	 *  Higher = stiffer anti-roll behavior, less body lean.
	 *  k=5000 with typical 0.01m differential → 50N per wheel → gentle torque. */
	stiffness: number;
	/** Differential damping (N·s/m). Prevents oscillation in pitch/roll. */
	damping: number;
	/** Force clamp per wheel (N). Prevents numerical explosions. */
	maxForce: number;
}

/** Per-wheel state tracked between frames for damping velocity calculation. */
interface WheelState {
	prevCompression: number;
}

const DEFAULT_CONFIG: CustomSuspensionConfig = {
	stiffness: 5000,
	damping: 300,
	maxForce: 5000,
};

export class CustomSuspension {
	private config: CustomSuspensionConfig;
	private wheels: WheelState[] = [];
	private anchors: { x: number; y: number; z: number }[] = [];
	private enabled = true;

	constructor(config?: Partial<CustomSuspensionConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Set wheel anchor positions (body-local coordinates). Call once during setup. */
	setAnchors(anchors: { x: number; y: number; z: number }[]): void {
		this.anchors = anchors;
		this.wheels = anchors.map(() => ({ prevCompression: 0 }));
	}

	enable(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Apply differential suspension forces for one physics substep.
	 *
	 * Reads per-wheel compression from Rapier, computes the difference from the
	 * average, and applies forces at wheel anchor positions. Net vertical force
	 * is always zero — only torque (pitch/roll) is produced.
	 *
	 * @param vehicle - Rapier vehicle controller (for reading suspension state)
	 * @param body - Rapier rigid body (for applying impulses)
	 * @param suspRestLength - Suspension rest length (m)
	 * @param dt - Substep timestep (s)
	 */
	apply(
		vehicle: RAPIER.DynamicRayCastVehicleController,
		body: RAPIER.RigidBody,
		suspRestLength: number,
		dt: number,
	): void {
		if (!this.enabled || this.anchors.length === 0) return;

		const { stiffness, damping, maxForce } = this.config;

		// Phase 1: Gather per-wheel compression and velocities
		const n = this.anchors.length;
		const compressions: number[] = [];
		const velocities: number[] = [];
		let groundedCount = 0;

		for (let i = 0; i < n; i++) {
			const len = vehicle.wheelSuspensionLength(i);
			if (len === null || len === undefined) {
				compressions.push(0);
				velocities.push(0);
				continue;
			}
			groundedCount++;
			const comp = suspRestLength - len;
			compressions.push(comp);
			velocities.push((comp - this.wheels[i].prevCompression) / dt);
			this.wheels[i].prevCompression = comp;
		}

		// Need at least 2 grounded wheels for differential forces to make sense
		if (groundedCount < 2) return;

		// Phase 2: Compute averages
		let avgComp = 0;
		let avgVel = 0;
		for (let i = 0; i < n; i++) {
			avgComp += compressions[i];
			avgVel += velocities[i];
		}
		avgComp /= groundedCount;
		avgVel /= groundedCount;

		// Phase 3: Apply differential forces
		for (let i = 0; i < n; i++) {
			if (compressions[i] === 0 && velocities[i] === 0) continue;

			// Force = k × (comp - avg) + c × (vel - avg)
			// Positive = push body UP at this wheel
			const diffComp = compressions[i] - avgComp;
			const diffVel = velocities[i] - avgVel;
			let force = stiffness * diffComp + damping * diffVel;

			// Clamp to prevent extreme forces from numerical noise
			force = Math.max(-maxForce, Math.min(maxForce, force));

			if (Math.abs(force) < 0.5) continue;

			const worldAnchor = localToWorld(body, this.anchors[i]);
			body.applyImpulseAtPoint({ x: 0, y: force * dt, z: 0 }, worldAnchor, true);
		}
	}

	/** Reset internal state (e.g., after teleport/reset). */
	reset(): void {
		this.wheels = this.anchors.map(() => ({ prevCompression: 0 }));
	}

	/**
	 * Apply weight-transfer-based differential suspension forces.
	 *
	 * Instead of reading Rapier's uniform compression, computes virtual compression
	 * offsets from longitudinal and lateral acceleration, then applies differential
	 * forces at wheel anchors.
	 *
	 * @param body - Rapier rigid body
	 * @param longitudinalAccel - Forward acceleration (m/s²), positive = accelerating
	 * @param lateralAccel - Lateral acceleration (m/s²), positive = turning left
	 * @param mass - Vehicle mass (kg)
	 * @param cgHeight - Center of gravity height (m)
	 * @param wheelbase - Distance between front and rear axles (m)
	 * @param trackWidth - Distance between left and right wheels (m)
	 * @param dt - Timestep (s)
	 */
	applyWeightTransfer(
		body: RAPIER.RigidBody,
		longitudinalAccel: number,
		lateralAccel: number,
		mass: number,
		cgHeight: number,
		wheelbase: number,
		trackWidth: number,
		dt: number,
	): void {
		if (!this.enabled || this.anchors.length < 4) return;

		const { stiffness, maxForce, damping } = this.config;

		// Scale factor: real cars have stiff anti-roll bars that limit body roll.
		// 0.4 = 40% of idealized weight transfer makes for visible but not excessive lean.
		const wtScale = 0.4;

		// Longitudinal weight transfer: ΔFz = (mass × accel × cgHeight) / wheelbase
		// Under braking (negative accel): front gains, rear loses
		// Under acceleration (positive accel): rear gains, front loses
		const longTransfer = (mass * longitudinalAccel * cgHeight * wtScale) / (wheelbase || 1);

		// Lateral weight transfer: ΔFz = (mass × lateralAccel × cgHeight) / trackWidth
		// Positive lateral accel (turning left): right side gains, left loses
		const latTransfer = (mass * lateralAccel * cgHeight * wtScale) / (trackWidth || 1);

		// Convert weight transfer to virtual compression offsets (F = k × Δx → Δx = F / k)
		// [FL, FR, RL, RR]
		// FL: loses long transfer (front under accel), gains lat transfer (left under left turn)
		// FR: loses long transfer, loses lat transfer
		// RL: gains long transfer, gains lat transfer
		// RR: gains long transfer, loses lat transfer
		const offsets = [
			(-longTransfer + latTransfer) / stiffness, // FL
			(-longTransfer - latTransfer) / stiffness, // FR
			(longTransfer + latTransfer) / stiffness, // RL
			(longTransfer - latTransfer) / stiffness, // RR
		];

		// Compute average offset
		const avgOffset = (offsets[0] + offsets[1] + offsets[2] + offsets[3]) / 4;

		// Apply differential forces (only the difference from average)
		for (let i = 0; i < 4; i++) {
			const diffOffset = offsets[i] - avgOffset;
			// Apply spring force with damping for stability
			const vel = (diffOffset - (this.wheels[i]?.prevCompression ?? 0)) / dt;
			this.wheels[i] = { prevCompression: diffOffset };
			let force = stiffness * diffOffset + damping * vel;

			// Clamp
			force = Math.max(-maxForce, Math.min(maxForce, force));
			if (Math.abs(force) < 0.5) continue;

			const worldAnchor = localToWorld(body, this.anchors[i]);
			body.applyImpulseAtPoint({ x: 0, y: force * dt, z: 0 }, worldAnchor, true);
		}
	}
}

/**
 * Transform a body-local point to world space using rigid body position + quaternion.
 * Uses the full rotation matrix from the quaternion — no approximation.
 */
function localToWorld(
	body: RAPIER.RigidBody,
	local: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
	const pos = body.translation();
	const r = body.rotation();
	const ix = r.x,
		iy = r.y,
		iz = r.z,
		iw = r.w;
	const xx = ix * ix,
		yy = iy * iy,
		z2 = iz * iz;

	return {
		x: pos.x + (1 - 2 * (yy + z2)) * local.x + 2 * (ix * iy - iw * iz) * local.y + 2 * (ix * iz + iw * iy) * local.z,
		y: pos.y + 2 * (ix * iy + iw * iz) * local.x + (1 - 2 * (xx + z2)) * local.y + 2 * (iy * iz - iw * ix) * local.z,
		z: pos.z + 2 * (ix * iz - iw * iy) * local.x + 2 * (iy * iz + iw * ix) * local.y + (1 - 2 * (xx + yy)) * local.z,
	};
}
