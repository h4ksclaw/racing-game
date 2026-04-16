/**
 * VehicleController — arcade/bicycle-model car physics.
 *
 * Orchestrates modular subsystems:
 *   Engine    → RPM, torque curve, rev limiter, engine braking
 *   Gearbox   → automatic shifting with clutch simulation
 *   Brakes    → g-based deceleration (foot + handbrake)
 *   TireModel → slip angles, lateral forces, grip circle
 *   DragModel → rolling resistance + aerodynamic drag
 *
 * Ground collision via terrain.getHeight() sampling.
 * Car body tilts with terrain surface normal.
 *
 * Coordinate convention:
 * - heading=0 → car faces +Z (matching GLTF model forward)
 * - +heading → CCW turn from top (left turn)
 * - local frame: X=forward, Y=lateral (right-positive)
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildCarModel, type CarModel } from "./CarModel.ts";
import type { CarConfig, VehicleInput, VehicleState } from "./types.ts";
import { RACE_CAR } from "./types.ts";

export interface TerrainProvider {
	getHeight(x: number, z: number): number;
	getNormal?(x: number, z: number): { x: number; y: number; z: number };
}

export class VehicleController {
	model: THREE.Group | null = null;
	private wheelMeshes: THREE.Object3D[] = [];
	private terrain: TerrainProvider | null = null;

	state: VehicleState = {
		speed: 0,
		rpm: 800,
		gear: 1,
		steeringAngle: 0,
		throttle: 0,
		brake: 0,
		onGround: true,
	};

	private car: CarModel;
	config: CarConfig;

	// Runtime chassis overrides from marker auto-derivation

	// World-space state
	private posX = 0;
	private posY = 2;
	private posZ = 0;
	private heading = 0;

	// Model offset: Y offset from model origin to PhysicsMarker (ground contact)
	private modelGroundOffset = 0;

	// Velocities
	private localVelX = 0;
	private localVelY = 0;
	private verticalVel = 0;
	private yawRate = 0;

	// Body orientation (terrain tilt)
	private pitch = 0;
	private roll = 0;

	// Steering
	private steerAngle = 0;
	private readonly STEER_SPEED = 4.0;

	// CG geometry (derived from config)
	private cgToFront: number;
	private cgToRear: number;
	private cgHeight: number;
	private yawInertia: number;

	constructor(config: CarConfig = RACE_CAR) {
		this.config = config;
		this.car = buildCarModel(config);

		const wb = config.chassis.wheelBase;
		const wf = config.chassis.weightFront ?? 0.55;
		this.cgToFront = wb * wf;
		this.cgToRear = wb * (1 - wf);
		this.cgHeight = config.chassis.cgHeight;
		this.yawInertia = config.chassis.mass * this.cgToFront * this.cgToRear;
	}

	async loadModel(): Promise<THREE.Group> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(this.config.modelPath);
		this.model = gltf.scene;

		// ── Apply model scale if specified ─────────────────────────────
		const scale =
			this.config.modelScale && this.config.modelScale !== 1 ? this.config.modelScale : 1;
		if (scale !== 1) {
			// Scale geometry directly (more reliable than group transform)
			this.model.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
				}
				// Also scale marker positions
				if (child.position.lengthSq() > 0) {
					child.position.multiplyScalar(scale);
				}
			});
			this.model.updateMatrixWorld(true);
		}

		// ── Auto-derive chassis from marker objects ─────────────────────
		this.autoDeriveChassis();

		// ── Find wheel meshes for visual steering/spin ──────────────────
		this.wheelMeshes = [];
		for (const name of [
			"wheel-front-left",
			"wheel-front-right",
			"wheel-back-left",
			"wheel-back-right",
		]) {
			const obj = this.model.getObjectByName(name);
			if (obj) this.wheelMeshes.push(obj);
		}

		// ── Generate wheel meshes from WheelRig markers if none found ────
		if (this.wheelMeshes.length === 0) {
			this.generateWheelsFromMarkers();
		}

		return this.model;
	}

	/**
	 * Auto-derive chassis dimensions from WheelRig_* and PhysicsMarker objects
	 * embedded in the GLB model. Falls back to config values if markers are missing.
	 *
	 * Expected marker hierarchy:
	 *   CarBody (mesh)
	 *     ├── PhysicsMarker          @ ground contact point
	 *     ├── WheelRig_FrontLeft    @ front-left wheel center
	 *     ├── WheelRig_FrontRight   @ front-right wheel center
	 *     ├── WheelRig_RearLeft     @ rear-left wheel center
	 *     └── WheelRig_RearRight    @ rear-right wheel center
	 *
	 * Derived values:
	 *   wheelRadius   = |WheelRig.y - PhysicsMarker.y|
	 *   wheelBase     = |Front.z - Rear.z|
	 *   wheelPositions = marker translations
	 *   halfExtents   = body mesh bounding box
	 *   cgHeight      = halfExtents.y * 1.1 (or PhysicsMarker-based estimate)
	 */
	private autoDeriveChassis(): void {
		if (!this.model) return;

		// Find marker objects
		const physicsMarker = this.findMarkerRecursive(this.model, "PhysicsMarker");
		const wheelRigs: THREE.Object3D[] = [];
		for (const name of [
			"WheelRig_FrontLeft",
			"WheelRig_FrontRight",
			"WheelRig_RearLeft",
			"WheelRig_RearRight",
		]) {
			const obj = this.findMarkerRecursive(this.model, name);
			if (obj) wheelRigs.push(obj);
		}

		if (wheelRigs.length < 4 || !physicsMarker) return; // markers not found, use config

		// Get world-space positions
		const markerPos = new THREE.Vector3();
		physicsMarker.getWorldPosition(markerPos);
		const pmY = markerPos.y;

		const wheelWorldPositions: THREE.Vector3[] = [];
		for (const rig of wheelRigs) {
			const wp = new THREE.Vector3();
			rig.getWorldPosition(wp);
			wheelWorldPositions.push(wp);
		}

		// Derive wheel radius (average distance from wheel center to ground)
		const radii = wheelWorldPositions.map((wp) => Math.abs(wp.y - pmY));
		const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;

		// Derive wheelbase from front-to-rear Z distance
		const frontZ = (wheelWorldPositions[0].z + wheelWorldPositions[1].z) / 2;
		const rearZ = (wheelWorldPositions[2].z + wheelWorldPositions[3].z) / 2;
		const wheelBase = Math.abs(frontZ - rearZ);

		// Compute body mesh bounding box
		const bodyBox = new THREE.Box3();
		this.model.traverse((child) => {
			if (child instanceof THREE.Mesh && child.name !== "textured_mesh_BACKUP") {
				child.geometry.computeBoundingBox();
				if (child.geometry.boundingBox) {
					const box = child.geometry.boundingBox.clone();
					box.applyMatrix4(child.matrixWorld);
					bodyBox.union(box);
				}
			}
		});

		const bodySize = new THREE.Vector3();
		bodyBox.getSize(bodySize);
		const bodyCenter = new THREE.Vector3();
		bodyBox.getCenter(bodyCenter);

		// CG height: estimate from body geometry (center of mass ~40% up from bottom)
		const bodyBottom = bodyBox.min.y;
		const bodyTop = bodyBox.max.y;
		const cgHeight = Math.max(pmY - bodyBottom, (bodyTop - bodyBottom) * 0.4);

		// Model offset: PhysicsMarker defines where ground is relative to model origin.
		// The physics system positions the car at posY = groundY + wheelRadius + restLength.
		// We need the model positioned so wheel bottoms align with physics wheel bottoms.
		// model.position.y = posY - pmY, so modelGroundOffset = -pmY
		this.modelGroundOffset = -pmY;

		// Apply derived values (convert to local coords relative to model root)
		const rootPos = new THREE.Vector3();
		this.model.getWorldPosition(rootPos);

		this.config = {
			...this.config,
			chassis: {
				...this.config.chassis,
				wheelRadius: avgRadius,
				wheelBase,
				wheelPositions: wheelWorldPositions.map((wp) => ({
					x: wp.x - rootPos.x,
					y: wp.y - rootPos.y,
					z: wp.z - rootPos.z,
				})),
				halfExtents: [bodySize.x / 2, bodySize.y / 2, bodySize.z / 2],
				cgHeight,
			},
		};

		// Recompute derived values with new chassis

		// Recompute derived CG values
		const wf = this.config.chassis.weightFront ?? 0.55;
		this.cgToFront = wheelBase * wf;
		this.cgToRear = wheelBase * (1 - wf);
		this.cgHeight = cgHeight;
		this.yawInertia = this.config.chassis.mass * this.cgToFront * this.cgToRear;
	}

	/** Recursively search for a named object in the scene graph. */
	private findMarkerRecursive(parent: THREE.Object3D, name: string): THREE.Object3D | null {
		for (const child of parent.children) {
			if (child.name === name) return child;
			const found = this.findMarkerRecursive(child, name);
			if (found) return found;
		}
		return null;
	}

	/**
	 * Generate simple tire+rim wheel meshes at WheelRig marker positions.
	 * Used when the GLB has markers but no named wheel meshes.
	 */
	private generateWheelsFromMarkers(): void {
		if (!this.model) return;

		const wheelNames = [
			"WheelRig_FrontLeft",
			"WheelRig_FrontRight",
			"WheelRig_RearLeft",
			"WheelRig_RearRight",
		];

		const radius = this.config.chassis.wheelRadius;
		const width = radius * 0.8; // tire width ~80% of radius

		for (const name of wheelNames) {
			const marker = this.findMarkerRecursive(this.model, name);
			if (!marker) continue;

			// Tire (black cylinder)
			const tireGeom = new THREE.CylinderGeometry(radius, radius, width, 16);
			tireGeom.rotateZ(Math.PI / 2); // align with X axis (car forward)
			const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
			const tireMesh = new THREE.Mesh(tireGeom, tireMat);

			// Rim (silver cylinder, slightly smaller)
			const rimGeom = new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, width * 0.85, 8);
			rimGeom.rotateZ(Math.PI / 2);
			const rimMat = new THREE.MeshStandardMaterial({
				color: 0x888888,
				metalness: 0.8,
				roughness: 0.3,
			});
			const rimMesh = new THREE.Mesh(rimGeom, rimMat);
			tireMesh.add(rimMesh);

			// Position at marker's local position (already scaled)
			tireMesh.position.copy(marker.position);

			this.model.add(tireMesh);
			this.wheelMeshes.push(tireMesh);
		}
	}

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
	}

	update(input: VehicleInput, delta: number): void {
		const dt = Math.min(delta, 1 / 30);
		const { chassis, engine: engSpec } = this.config;
		const mass = chassis.mass;
		const wheelRadius = chassis.wheelRadius;
		const wheelBase = chassis.wheelBase;
		const { engine, gearbox, brakes, tires, drag } = this.car;

		// ═══════════════════════════════════════════════════════════
		// 1. STEERING
		// ═══════════════════════════════════════════════════════════
		const speedKmh = Math.abs(this.localVelX) * 3.6;
		// Speed-dependent steering reduction (more aggressive at high speed)
		const speedReduction = Math.max(0.15, 1 - (speedKmh / 140) ** 1.5);
		const targetSteer =
			((input.left ? 1 : 0) - (input.right ? 1 : 0)) * chassis.maxSteerAngle * speedReduction;

		const maxDelta = this.STEER_SPEED * dt;
		const steerDiff = targetSteer - this.steerAngle;
		this.steerAngle =
			Math.abs(steerDiff) < maxDelta
				? targetSteer
				: this.steerAngle + Math.sign(steerDiff) * maxDelta;
		this.state.steeringAngle = this.steerAngle;

		// ═══════════════════════════════════════════════════════════
		// 2. WEIGHT DISTRIBUTION
		// ═══════════════════════════════════════════════════════════
		const g = 9.82;
		const totalWeight = mass * g;
		const longAccel = input.forward
			? engSpec.torqueNm / mass
			: input.handbrake
				? -(this.config.brakes.handbrakeG * 2) * g
				: 0;
		const weightTransfer = (mass * longAccel * this.cgHeight) / wheelBase;
		const normalFront = Math.max(
			totalWeight * 0.1,
			(totalWeight * this.cgToRear) / wheelBase - weightTransfer,
		);
		const normalRear = Math.max(
			totalWeight * 0.1,
			(totalWeight * this.cgToFront) / wheelBase + weightTransfer,
		);

		// ═══════════════════════════════════════════════════════════
		// 3. BRAKE INPUT
		// ═══════════════════════════════════════════════════════════
		brakes.isBraking = input.backward && this.localVelX > -0.1;
		brakes.isHandbrake = !!input.handbrake;

		// ═══════════════════════════════════════════════════════════
		// 4. TIRE FORCES (bicycle model — lateral)
		// ═══════════════════════════════════════════════════════════
		const tireForces = tires.compute(
			this.localVelX,
			this.localVelY,
			this.yawRate,
			this.steerAngle,
			this.cgToFront,
			this.cgToRear,
			normalFront,
			normalRear,
			brakes.rearGripFactor,
		);

		// ═══════════════════════════════════════════════════════════
		// 5. ENGINE + GEARBOX + DRIVETRAIN
		// ═══════════════════════════════════════════════════════════
		engine.throttle = input.forward ? 1 : input.backward && this.localVelX <= -0.5 ? 0.4 : 0;

		// Gearbox first (determines gear ratio for this frame)
		gearbox.update(dt, engine, this.localVelX, brakes.isBraking);

		// Engine RPM from wheel speed
		engine.update(this.localVelX, gearbox.effectiveRatio, wheelRadius, dt);

		// Engine force at wheels (includes traction limit & rev limiter)
		let engineForce = engine.getWheelForce(
			gearbox.effectiveRatio,
			wheelRadius,
			tires.config.maxTraction,
		);

		// Reduce during shift (clutch disengaged)
		if (gearbox.isShifting) engineForce *= 0.3;

		// Reverse: only when nearly stopped and no forward input
		if (input.backward && this.localVelX <= 0.1 && this.localVelX > -0.5 && !input.forward) {
			engineForce = -engSpec.torqueNm * 0.3;
		}

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

		// Snap to zero if brakes would reverse velocity
		this.localVelX = brakes.applyResult(this.localVelX);

		// Lateral (from tire model)
		this.localVelY += (tireForces.lateral / mass) * dt;

		// Yaw (speed-dependent damping — more stable at high speed)
		const yawDampCoeff = 1.5 + (speedKmh / 200) * 2.0;
		this.yawRate += (tireForces.yawTorque / this.yawInertia) * dt;
		this.yawRate *= 1 - yawDampCoeff * dt;

		// Kill tiny values
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
		// 11. GRAVITY + TERRAIN
		// ═══════════════════════════════════════════════════════════
		this.verticalVel -= g * dt;
		this.posY += this.verticalVel * dt;

		if (this.terrain) {
			const groundY = this.terrain.getHeight(this.posX, this.posZ);
			const restH = wheelRadius + chassis.suspensionRestLength;

			if (this.posY <= groundY + restH) {
				this.posY = groundY + restH;
				this.verticalVel = this.verticalVel < -1.0 ? this.verticalVel * -0.2 : 0;
				this.state.onGround = true;
			} else {
				this.state.onGround = false;
			}

			if (this.terrain.getNormal) {
				const normal = this.terrain.getNormal(this.posX, this.posZ);
				if (normal) {
					const fwdSlope = -(normal.x * sh + normal.z * ch);
					const rightSlope = -(normal.x * ch - normal.z * sh);
					const tiltSpeed = 5.0;
					this.pitch += (Math.atan2(fwdSlope, normal.y) - this.pitch) * Math.min(1, tiltSpeed * dt);
					this.roll += (Math.atan2(rightSlope, normal.y) - this.roll) * Math.min(1, tiltSpeed * dt);
					this.localVelX += -g * Math.sin(this.pitch) * dt;
				}
			}
		}

		// ═══════════════════════════════════════════════════════════
		// 12. HEADING
		// ═══════════════════════════════════════════════════════════
		this.heading += this.yawRate * dt;

		// ═══════════════════════════════════════════════════════════
		// 13. OUTPUT STATE
		// ═══════════════════════════════════════════════════════════
		this.state.speed = this.localVelX;
		this.state.rpm = engine.rpm;
		this.state.gear = gearbox.currentGear + 1;
		this.state.throttle = engine.throttle;
		this.state.brake = brakes.brakePressure;
	}

	syncVisuals(): void {
		if (!this.model) return;

		this.model.position.set(this.posX, this.posY + this.modelGroundOffset, this.posZ);
		this.model.rotation.set(this.pitch, this.heading, this.roll);

		for (let i = 0; i < 4; i++) {
			const mesh = this.wheelMeshes[i];
			if (!mesh) continue;

			if (i < 2) {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, this.steerAngle, 0));
			} else {
				mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			}

			const spinAngle = (this.state.speed / this.config.chassis.wheelRadius) * 0.016;
			const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spinAngle);
			mesh.quaternion.multiply(spinQ);
		}
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
		this.steerAngle = 0;
		this.pitch = 0;
		this.roll = 0;
		this.car.gearbox.currentGear = 0;
		this.car.gearbox.isShifting = false;
		this.car.engine.rpm = this.config.engine.idleRPM;
		this.state.speed = 0;
		this.state.rpm = this.config.engine.idleRPM;
		this.state.steeringAngle = 0;
		this.state.throttle = 0;
		this.state.brake = 0;
		this.state.gear = 1;
	}

	dispose(): void {}
}
