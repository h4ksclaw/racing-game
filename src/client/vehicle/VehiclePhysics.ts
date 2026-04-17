/**
 * VehiclePhysics — pure math vehicle simulation.
 *
 * Orchestrates modular subsystems:
 *   EngineUnit  → RPM, torque, rev limiter, engine braking
 *   TireModel   → slip angles, lateral forces, grip circle
 *   Brakes      → g-based deceleration
 *   DragModel   → rolling resistance + aerodynamic drag
 *   Chassis     → mass, CG, suspension
 *
 * NO Three.js, NO audio, NO DOM. Pure math.
 * VehicleController creates this and calls update() each frame.
 *
 * Coordinate convention:
 * - heading=0 → car faces +Z
 * - +heading → CCW turn from top (left turn)
 * - local frame: X=forward, Y=lateral (right-positive)
 */

import { DragModel } from "./aero/DragModel.ts";
import { Chassis } from "./chassis/Chassis.ts";
import { checkPair, createBody, resolveCollision } from "./collision/index.ts";
import type { CarConfig } from "./configs.ts";
import { EngineUnit } from "./engine/EngineUnit.ts";
import { Brakes } from "./suspension/Brakes.ts";
import type { TireConfig } from "./suspension/TireModel.ts";
import { TireModel } from "./suspension/TireModel.ts";
import type { EngineTelemetry, TerrainProvider, VehicleInput, VehicleState } from "./types.ts";
import { TerrainHandler } from "./world/TerrainHandler.ts";

export class VehiclePhysics {
	readonly state: VehicleState;
	telemetry: EngineTelemetry;

	// Subsystem modules
	readonly engineUnit: EngineUnit;
	tires: TireModel;
	readonly brakes: Brakes;
	readonly drag: DragModel;
	chassis: Chassis;

	// Mutable config (marker auto-derivation modifies chassis at load time)
	config: CarConfig;

	readonly terrainHandler: TerrainHandler;

	// World-space position
	posX: number;
	posY: number;
	posZ: number;
	heading: number;

	// Velocities
	localVelX: number;
	localVelY: number;
	private verticalVel: number;
	private yawRate: number;

	// 3D angular velocity (rad/s) — pitch, yaw, roll
	private pitchRate: number;
	private rollRate: number;

	// Hull collision body (reusable for wall collision checks)
	private hullBody: ReturnType<typeof createBody>;

	// Body orientation (terrain tilt)
	pitch: number;
	roll: number;

	// Steering
	steerAngle: number;
	private readonly STEER_SPEED = 4.0;

	constructor(config: CarConfig) {
		this.config = config;
		this.chassis = new Chassis(config.chassis);

		// Build tire config with computed max traction
		const tireConfig: TireConfig = {
			...config.tires,
			maxTraction: config.chassis.mass * config.tires.tractionPct * 9.82,
		};

		this.engineUnit = new EngineUnit(config.engine, config.gearbox, config.chassis.wheelRadius);
		this.tires = new TireModel(tireConfig);
		this.brakes = new Brakes(config.brakes);
		this.drag = new DragModel(config.drag);

		// Initial state
		this.state = {
			speed: 0,
			rpm: config.engine.idleRPM,
			gear: 1,
			steeringAngle: 0,
			throttle: 0,
			brake: 0,
			onGround: true,
		};

		this.telemetry = this.engineUnit.getTelemetry(0);

		this.posX = 0;
		this.posY = 2;
		this.posZ = 0;
		this.heading = 0;
		this.localVelX = 0;
		this.localVelY = 0;
		this.verticalVel = 0;
		this.yawRate = 0;
		this.pitchRate = 0;
		this.rollRate = 0;
		this.pitch = 0;
		this.roll = 0;
		this.steerAngle = 0;
		this.terrainHandler = new TerrainHandler();

		// Pre-build hull collision body (reused for wall checks)
		this.hullBody = createBody({
			mass: config.chassis.mass,
			halfExtents: config.chassis.halfExtents,
			pos: { x: 0, y: 0, z: 0 },
		});
	}

	setTerrain(terrain: TerrainProvider): void {
		this.terrainHandler.setTerrain(terrain);
	}

	/** Rebuild chassis from modified config (after marker auto-derivation). */
	rebuildChassis(): void {
		this.chassis = new Chassis(this.config.chassis);
		const tireConfig: TireConfig = {
			...this.config.tires,
			maxTraction: this.config.chassis.mass * this.config.tires.tractionPct * 9.82,
		};
		this.tires = new TireModel(tireConfig);

		// Rebuild hull body with new dimensions
		this.hullBody = createBody({
			mass: this.config.chassis.mass,
			halfExtents: this.config.chassis.halfExtents,
			pos: { x: this.posX, y: this.posY, z: this.posZ },
		});
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);
		const { chassis } = this;
		const mass = chassis.spec.mass;
		const wheelRadius = chassis.spec.wheelRadius;
		const wheelBase = chassis.spec.wheelBase;
		const engine = this.engineUnit.engine;
		const gearbox = this.engineUnit.gearbox;
		const brakes = this.brakes;
		const tires = this.tires;
		const drag = this.drag;

		// ═══════════════════════════════════════════════════════════
		// 1. STEERING
		// ═══════════════════════════════════════════════════════════
		const speedKmh = Math.abs(this.localVelX) * 3.6;
		const speedReduction = Math.max(0.15, 1 - (speedKmh / 140) ** 1.5);
		const targetSteer = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * chassis.spec.maxSteerAngle * speedReduction;

		const maxDelta = this.STEER_SPEED * dt;
		const steerDiff = targetSteer - this.steerAngle;
		this.steerAngle = Math.abs(steerDiff) < maxDelta ? targetSteer : this.steerAngle + Math.sign(steerDiff) * maxDelta;
		this.state.steeringAngle = this.steerAngle;

		// ═══════════════════════════════════════════════════════════
		// 2. WEIGHT DISTRIBUTION
		// ═══════════════════════════════════════════════════════════
		const g = 9.82;
		const totalWeight = mass * g;
		const longAccel = input.forward
			? this.config.engine.torqueNm / mass
			: input.handbrake
				? -(this.config.brakes.handbrakeG * 2) * g
				: 0;
		const weightTransfer = (mass * longAccel * chassis.cgHeight) / wheelBase;
		const normalFront = Math.max(totalWeight * 0.1, (totalWeight * chassis.cgToRear) / wheelBase - weightTransfer);
		const normalRear = Math.max(totalWeight * 0.1, (totalWeight * chassis.cgToFront) / wheelBase + weightTransfer);

		// ═══════════════════════════════════════════════════════════
		// 3. BRAKE INPUT
		// ═══════════════════════════════════════════════════════════
		brakes.isBraking = input.backward && !input.forward && this.localVelX > 0.1;
		if (input.backward && input.forward && this.localVelX > 0.5) {
			brakes.isBraking = true;
		}
		brakes.isHandbrake = !!input.handbrake;

		// ═══════════════════════════════════════════════════════════
		// 4. TIRE FORCES (bicycle model — lateral)
		// ═══════════════════════════════════════════════════════════
		const tireForces = tires.compute(
			this.localVelX,
			this.localVelY,
			this.yawRate,
			this.steerAngle,
			chassis.cgToFront,
			chassis.cgToRear,
			normalFront,
			normalRear,
			brakes.rearGripFactor,
		);

		// ═══════════════════════════════════════════════════════════
		// 5. ENGINE + GEARBOX + DRIVETRAIN
		// ═══════════════════════════════════════════════════════════
		const isReversing = !!input.backward && !input.forward && this.localVelX < 1.0;
		engine.throttle = input.forward ? 1 : isReversing ? 0.5 : 0;

		gearbox.update(dt, engine, this.localVelX, brakes.isBraking);
		engine.update(this.localVelX, gearbox.effectiveRatio, wheelRadius, dt);

		let engineForce = engine.getWheelForce(gearbox.effectiveRatio, wheelRadius, tires.config.maxTraction);

		if (gearbox.isShifting) engineForce *= 0.3;

		if (isReversing) {
			engineForce = -this.config.engine.torqueNm * 0.4;
		}

		// Compute load for telemetry (engineForce / max possible force)
		const maxForce =
			(this.config.engine.torqueNm * gearbox.effectiveRatio * this.config.engine.finalDrive) / wheelRadius;
		engine.load = maxForce > 0 ? Math.min(1, Math.abs(engineForce) / maxForce) : 0;

		// ═══════════════════════════════════════════════════════════
		// 6. BRAKES
		// ═══════════════════════════════════════════════════════════
		const brakeForce = brakes.getForce(mass);

		// ═══════════════════════════════════════════════════════════
		// 7. ENGINE BRAKING
		// ═══════════════════════════════════════════════════════════
		const engineBrake = -engine.getEngineBraking(this.localVelX, mass);

		// ═══════════════════════════════════════════════════════════
		// 8. AERO + ROLLING DRAG
		// ═══════════════════════════════════════════════════════════
		const dragForce = -drag.getForce(this.localVelX);

		// ═══════════════════════════════════════════════════════════
		// 9. INTEGRATE
		// ═══════════════════════════════════════════════════════════
		const totalLongForce = engineForce + brakeForce + engineBrake + dragForce;
		this.localVelX += (totalLongForce / mass) * dt;

		this.localVelX = brakes.applyResult(this.localVelX);
		this.localVelY += (tireForces.lateral / mass) * dt;

		const yawDampCoeff = 1.0 + (speedKmh / 200) * 1.5;
		this.yawRate += (tireForces.yawTorque / chassis.yawInertia) * dt;
		this.yawRate *= 1 - yawDampCoeff * dt;

		if (Math.abs(this.localVelX) < 0.01 && !input.forward && !input.backward) this.localVelX = 0;
		if (Math.abs(this.localVelY) < 0.005) this.localVelY = 0;
		if (Math.abs(this.yawRate) < 0.0005) this.yawRate = 0;

		// ═══════════════════════════════════════════════════════════
		// 10. LOCAL → WORLD + POSITION
		// ═══════════════════════════════════════════════════════════
		const sh = Math.sin(this.heading);
		const ch = Math.cos(this.heading);
		this.posX += (this.localVelX * sh + this.localVelY * ch) * dt;
		this.posZ += (this.localVelX * ch - this.localVelY * sh) * dt;

		// ═══════════════════════════════════════════════════════════
		// 11. GRAVITY + TERRAIN (spring-damper suspension)
		// ═══════════════════════════════════════════════════════════
		this.verticalVel -= g * dt;
		this.posY += this.verticalVel * dt;

		const ts = this.terrainHandler.sample(this.posX, this.posZ, this.heading);
		if (ts) {
			const groundY = ts.groundY;
			const restH = wheelRadius + chassis.spec.suspensionRestLength;
			const targetY = groundY + restH;
			const penetration = targetY - this.posY;

			if (penetration > 0) {
				const springK = chassis.spec.suspensionStiffness;
				const dampK = chassis.spec.dampingCompression + chassis.spec.dampingRelaxation;
				const springForce = springK * penetration - dampK * this.verticalVel;

				this.verticalVel += (springForce / mass) * dt;

				// Hard floor prevents falling through terrain
				if (this.posY < groundY + wheelRadius * 0.8) {
					this.posY = groundY + wheelRadius * 0.8;
					this.verticalVel = this.verticalVel < -2.0 ? this.verticalVel * -0.1 : 0;
				}

				this.state.onGround = true;
			} else {
				// Airborne — but still check if we've gone below terrain
				if (this.posY < groundY + wheelRadius) {
					this.posY = groundY + wheelRadius;
					this.verticalVel = Math.max(0, this.verticalVel);
					this.state.onGround = true;
				} else {
					this.state.onGround = false;
				}
			}

			if (ts.normal) {
				// Tilt alignment — slower when collision tilt is active
				// so wall hits create visible body rotation before recovering
				const hasCollisionTilt = Math.abs(this.pitchRate) > 0.01 || Math.abs(this.rollRate) > 0.01;
				const tiltSpeed = hasCollisionTilt ? 1.5 : 5.0 + speedKmh * 0.02;
				this.pitch += (ts.pitch - this.pitch) * Math.min(1, tiltSpeed * dt);
				this.roll += (ts.roll - this.roll) * Math.min(1, tiltSpeed * dt);
				this.localVelX += -g * Math.sin(this.pitch) * dt;
			}

			// ── Road boundary collisions (hull-based impulse) ──
			// TODO: Replace roadBoundary trigger with full hull-vs-static-body
			// checkPair() once wall geometry is available as convex hulls.
			// The hull system gives proper 3D angular response (pitch/roll/yaw)
			// instead of the old yaw-only impulse calculation.
			if (ts.roadBoundary) {
				const rb = ts.roadBoundary;
				const carHalfW = chassis.spec.halfExtents[0];

				if (rb.distToWall <= carHalfW && rb.wallNormal) {
					const wn = rb.wallNormal;
					const worldVx = this.localVelX * sh + this.localVelY * ch;
					const worldVz = this.localVelX * ch - this.localVelY * sh;

					// Build a thin immovable wall body at the collision point.
					// TODO: Cache wall bodies per-frame instead of allocating per hit.
					const wallDist = carHalfW + rb.distToWall;
					// Guardrail-sized wall section (realistic proportions)
					// Short on Y (0.5m rail height) and Z (2m section length)
					// so hits create pitch/roll from off-center contact points
					const wallBody = createBody({
						mass: 1e10,
						halfExtents: [0.05, 0.25, 1.0],
						pos: {
							x: this.posX + wn.x * wallDist,
							y: this.posY + chassis.spec.halfExtents[1] * 0.5,
							z: this.posZ + wn.z * wallDist,
						},
						restitution: 0.3,
						friction: 0.5,
					});

					// Update car hull for collision check
					this.hullBody.pos = { x: this.posX, y: this.posY, z: this.posZ };
					this.hullBody.vel = { x: worldVx, y: this.verticalVel, z: worldVz };

					const result = checkPair(this.hullBody, wallBody);
					if (result) {
						resolveCollision(result, this.hullBody, wallBody);

						// Convert resolved velocity back to local frame
						const resolvedVx = this.hullBody.vel.x;
						const resolvedVz = this.hullBody.vel.z;
						this.localVelX = resolvedVx * sh + resolvedVz * ch;
						this.localVelY = resolvedVx * ch - resolvedVz * sh;
						this.verticalVel = this.hullBody.vel.y;

						// Yaw from hull angular response
						this.yawRate += this.hullBody.angVel.y;

						// Pitch/roll from off-center wall hits
						this.pitchRate += this.hullBody.angVel.x;
						this.rollRate += this.hullBody.angVel.z;
					}

					// Game-feel: lateral push prevents clipping through walls
					const pushDir = rb.lateralDist >= 0 ? -1 : 1;
					this.localVelY += pushDir * 80 * dt;

					if (!rb.onRoad && !rb.onKerb && !rb.onShoulder) {
						this.localVelY = pushDir * 5;
					}
				} else if (rb.onShoulder) {
					this.localVelX *= 1 - 1.5 * dt;
				} else if (rb.onKerb) {
					this.localVelX *= 1 - 0.3 * dt;
				}
			}
		}

		// ═══════════════════════════════════════════════════════════
		// 11b. HULL COLLISION — angular response for hard impacts
		// ═══════════════════════════════════════════════════════════
		// Position correction is handled by the spring-damper in step 11.
		// This only adds pitch/roll angular velocity from off-center ground hits.
		if (this.verticalVel < -3.0) {
			const impactForce = Math.abs(this.verticalVel) * this.config.chassis.mass;
			const cgOffset = this.chassis.cgToFront - this.chassis.cgToRear;
			const pitchImpulse = impactForce * cgOffset * 1e-4 * dt;
			this.pitchRate += pitchImpulse;
		}

		// Damp collision-induced angular velocity
		const angDamp = 1 - 2.0 * dt;
		this.pitchRate *= Math.max(0, angDamp);
		this.rollRate *= Math.max(0, angDamp);

		// Apply collision tilt directly (runs after terrain tilt in step 11)
		this.pitch += this.pitchRate * dt;
		this.roll += this.rollRate * dt;

		// ═══════════════════════════════════════════════════════════
		// 12. HEADING
		// ═══════════════════════════════════════════════════════════
		this.heading += this.yawRate * dt;

		// ═══════════════════════════════════════════════════════════
		// 13. OUTPUT STATE
		// ═══════════════════════════════════════════════════════════
		this.state.speed = this.localVelX;
		this.state.rpm = engine.rpm;
		this.state.gear = isReversing && this.localVelX < -0.1 ? -1 : gearbox.currentGear + 1;
		this.state.throttle = engine.throttle;
		this.state.brake = brakes.brakePressure;

		// Add collision-induced tilt for renderer (on top of terrain tilt)
		// This is NOT saved back to this.pitch/roll so terrain won't fight it
		// Update telemetry for audio/UI
		this.telemetry = {
			rpm: engine.rpm,
			gear: gearbox.currentGear,
			displayGear: this.state.gear,
			throttle: engine.throttle,
			load: engine.load,
			boost: this.engineUnit.isTurbo ? this.computeSimulatedBoost() : 0,
			speed: this.localVelX,
			isShifting: gearbox.isShifting,
			revLimited: engine.revLimited,
			isTurbo: this.engineUnit.isTurbo,
			grade: this.pitch,
			clutchEngaged: !gearbox.isShifting,
		};
	}

	/** Simple boost simulation for turbo engines (spool lag). */
	private simBoostNorm = 0;

	private computeSimulatedBoost(): number {
		const rpmFactor = Math.max(
			0,
			Math.min(
				1,
				(this.state.rpm - this.config.engine.idleRPM * 1.5) /
					(this.config.engine.maxRPM - this.config.engine.idleRPM * 1.5),
			),
		);
		const thrFactor = this.state.throttle ** 0.8;
		const targetBoost = rpmFactor * thrFactor;

		if (this.simBoostNorm === undefined) this.simBoostNorm = 0;
		const spoolUp = 0.012;
		const spoolDown = 0.04;
		if (targetBoost > this.simBoostNorm) {
			this.simBoostNorm += (targetBoost - this.simBoostNorm) * spoolUp;
		} else {
			this.simBoostNorm += (targetBoost - this.simBoostNorm) * spoolDown;
		}
		this.simBoostNorm = Math.max(0, Math.min(1, this.simBoostNorm));
		return this.simBoostNorm;
	}

	getPosition(): { x: number; y: number; z: number } {
		return { x: this.posX, y: this.posY, z: this.posZ };
	}

	getForward(): { x: number; y: number; z: number } {
		return { x: Math.sin(this.heading), y: 0, z: Math.cos(this.heading) };
	}

	reset(x: number, y: number, z: number, rotation = 0): void {
		this.posX = x;
		this.posY = y;
		this.posZ = z;
		this.heading = rotation;
		this.localVelX = 0;
		this.localVelY = 0;
		this.verticalVel = 0;
		this.yawRate = 0;
		this.pitchRate = 0;
		this.rollRate = 0;
		this.steerAngle = 0;
		this.pitch = 0;
		this.roll = 0;
		this.engineUnit.engine.rpm = this.config.engine.idleRPM;
		this.engineUnit.gearbox.currentGear = 0;
		this.engineUnit.gearbox.isShifting = false;
		this.simBoostNorm = 0;
		this.state.speed = 0;
		this.state.rpm = this.config.engine.idleRPM;
		this.state.steeringAngle = 0;
		this.state.throttle = 0;
		this.state.brake = 0;
		this.state.gear = 1;
		this.telemetry = this.engineUnit.getTelemetry(0);
	}
}
