/**
 * Vehicle physics — cannon-es RaycastVehicle wrapper.
 */

import { PHYSICS } from "@shared/constants.ts";
import { Body, Box, RaycastVehicle, Vec3 } from "cannon-es";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import type { PhysicsWorld } from "../game/PhysicsWorld.ts";

export interface VehicleOptions {
	mass: number;
	position: { x: number; y: number; z: number };
	color?: number;
}

export class Vehicle {
	private chassis: Body;
	private raycastVehicle: RaycastVehicle;
	private mesh: Mesh;
	private wheelMeshes: Mesh[] = [];

	constructor(physics: PhysicsWorld, options: VehicleOptions) {
		// Chassis shape
		const chassisShape = new Box(new Vec3(1, 0.5, 2));
		this.chassis = new Body({
			mass: options.mass,
			position: new Vec3(options.position.x, options.position.y, options.position.z),
		});
		this.chassis.addShape(chassisShape);

		// Three.js visual
		this.mesh = new Mesh(
			new BoxGeometry(2, 1, 4),
			new MeshStandardMaterial({ color: options.color ?? 0xff0000 }),
		);
		this.mesh.castShadow = true;

		// Raycast vehicle
		this.raycastVehicle = new RaycastVehicle({
			chassisBody: this.chassis,
			indexRightAxis: 0,
			indexUpAxis: 1,
			indexForwardAxis: 2,
		});

		// Add wheels (front-left, front-right, rear-left, rear-right)
		const wheelPositions: [number, number, number][] = [
			[-1, -0.3, 1.3],
			[1, -0.3, 1.3],
			[-1, -0.3, -1.3],
			[1, -0.3, -1.3],
		];

		for (const pos of wheelPositions) {
			this.raycastVehicle.addWheel({
				directionLocal: new Vec3(0, -1, 0),
				chassisConnectionPointLocal: new Vec3(...pos),
				maxSuspensionForce: PHYSICS.MAX_SUSPENSION_FORCE,
				maxSuspensionTravel: PHYSICS.MAX_SUSPENSION_TRAVEL,
				radius: PHYSICS.WHEEL_RADIUS,
				suspensionRestLength: PHYSICS.SUSPENSION_REST_LENGTH,
				suspensionStiffness: PHYSICS.SUSPENSION_STIFFNESS,
				dampingRelaxation: PHYSICS.DAMPING_RELAXATION,
				dampingCompression: PHYSICS.DAMPING_COMPRESSION,
				frictionSlip: PHYSICS.FRICTION_SLIP_NORMAL,
				rollInfluence: PHYSICS.ROLL_INFLUENCE,
				customSlidingRotationalSpeed: -30,
				useCustomSlidingRotationalSpeed: true,
			});

			// Wheel visual
			const wheelMesh = new Mesh(
				new BoxGeometry(PHYSICS.WHEEL_RADIUS, PHYSICS.WHEEL_RADIUS, PHYSICS.WHEEL_RADIUS),
				new MeshStandardMaterial({ color: 0x333333 }),
			);
			this.wheelMeshes.push(wheelMesh);
		}

		physics.world.addBody(this.chassis);
		physics.world.addBody(this.raycastVehicle as unknown as Body);
	}

	getMesh(): Mesh {
		return this.mesh;
	}

	getWheelMeshes(): Mesh[] {
		return this.wheelMeshes;
	}

	getChassis(): Body {
		return this.chassis;
	}

	getRaycastVehicle(): RaycastVehicle {
		return this.raycastVehicle;
	}

	getSpeed(): number {
		const vel = this.chassis.velocity;
		return Math.round(Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6);
	}

	/** Sync Three.js mesh with physics body */
	syncMesh(): void {
		this.mesh.position.set(
			this.chassis.position.x,
			this.chassis.position.y,
			this.chassis.position.z,
		);
		this.mesh.quaternion.set(
			this.chassis.quaternion.x,
			this.chassis.quaternion.y,
			this.chassis.quaternion.z,
			this.chassis.quaternion.w,
		);

		// Update wheel visuals
		for (let i = 0; i < this.raycastVehicle.wheelInfos.length; i++) {
			this.raycastVehicle.updateWheelTransform(i);
			const t = this.raycastVehicle.wheelInfos[i].worldTransform;
			this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
			this.wheelMeshes[i].quaternion.set(
				t.quaternion.x,
				t.quaternion.y,
				t.quaternion.z,
				t.quaternion.w,
			);
		}
	}

	/** Reset vehicle to a position */
	resetTo(position: { x: number; y: number; z: number }): void {
		this.chassis.position.set(position.x, position.y, position.z);
		this.chassis.velocity.setZero();
		this.chassis.angularVelocity.setZero();
		this.chassis.quaternion.set(0, 0, 0, 1);
	}
}
