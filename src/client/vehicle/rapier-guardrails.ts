/**
 * Guardrail collision bodies for Rapier.
 *
 * Generates fixed cuboid rigid bodies along road edges,
 * covering a configurable range of road samples around the car.
 * Rebuilds only when the sample range changes (hash-based dedup).
 */

import RAPIER from "@dimforge/rapier3d-compat";
import type { TerrainProvider } from "./types.ts";

/** Number of road samples in each direction from the car. */
const RAIL_RANGE = 100;

/** Cuboid properties for each guardrail segment. */
const RAIL_HALF_WIDTH = 0.5;
const RAIL_HEIGHT = 50;
const RAIL_FRICTION = 0.3;
const RAIL_RESTITUTION = 0.2;

/** Minimum segment half-length (skip tiny segments). */
const MIN_SEGMENT_LENGTH = 0.1;

/**
 * Manages guardrail rigid bodies in a Rapier world.
 * Builds walls along road edges for the RAIL_RANGE of samples around the car.
 */
export class Guardrails {
	private world: RAPIER.World;
	private terrain: TerrainProvider;
	private bodies: RAPIER.RigidBody[] = [];
	private lastHash = "";

	constructor(world: RAPIER.World, terrain: TerrainProvider) {
		this.world = world;
		this.terrain = terrain;
	}

	get bodyList(): readonly RAPIER.RigidBody[] {
		return this.bodies;
	}

	get bodyCount(): number {
		return this.bodies.length;
	}

	/**
	 * Rebuild guardrails around the given position if needed.
	 * Uses a hash of the sample range to skip redundant rebuilds.
	 */
	update(carX: number, carZ: number): boolean {
		if (!this.terrain.getRoadBoundary) return false;

		const terrainAny = this.terrain as unknown as {
			nearestRoad(x: number, z: number): { sampleIndex: number };
			samples: Array<{
				point: { x: number; y: number; z: number };
				tangent: { x: number; z: number };
			}>;
		};
		const { sampleIndex } = terrainAny.nearestRoad(carX, carZ);
		const samples = terrainAny.samples;
		if (!samples || samples.length === 0) return false;

		const startIdx = Math.max(0, sampleIndex - RAIL_RANGE);
		const endIdx = Math.min(samples.length - 1, sampleIndex + RAIL_RANGE);

		const hash = `${startIdx}-${endIdx}`;
		if (hash === this.lastHash) return false;
		this.lastHash = hash;

		// Remove old bodies
		for (const b of this.bodies) this.world.removeRigidBody(b);
		this.bodies = [];

		// Get guardrail distance from road center
		const rb = this.terrain.getRoadBoundary(carX, carZ);
		const railDist = rb?.guardrailDist ?? 15;

		// Build walls along road edges
		for (let i = startIdx; i < endIdx; i++) {
			const s = samples[i];
			const sNext = samples[i + 1];
			if (!sNext) continue;

			const tLen = Math.sqrt(s.tangent.x ** 2 + s.tangent.z ** 2);
			if (tLen < 0.001) continue;

			// Normal = perpendicular to tangent
			const nx = -s.tangent.z / tLen;
			const nz = s.tangent.x / tLen;

			const hl = Math.sqrt((sNext.point.x - s.point.x) ** 2 + (sNext.point.z - s.point.z) ** 2) / 2;
			if (hl < MIN_SEGMENT_LENGTH) continue;

			const mx = (s.point.x + sNext.point.x) / 2;
			const mz = (s.point.z + sNext.point.z) / 2;
			const my = (s.point.y + sNext.point.y) / 2;
			const angle = Math.atan2(s.tangent.x, s.tangent.z);

			// Left guardrail (note: normal direction is opposite to visual binormal)
			const lx = mx - nx * railDist;
			const lz = mz - nz * railDist;
			const lBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(lx, my, lz));
			lBody.setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }, true);
			this.world.createCollider(
				RAPIER.ColliderDesc.cuboid(RAIL_HALF_WIDTH, RAIL_HEIGHT, hl)
					.setFriction(RAIL_FRICTION)
					.setRestitution(RAIL_RESTITUTION),
				lBody,
			);
			this.bodies.push(lBody);

			// Right guardrail
			const rx = mx + nx * railDist;
			const rz = mz + nz * railDist;
			const rBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(rx, my, rz));
			rBody.setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }, true);
			this.world.createCollider(
				RAPIER.ColliderDesc.cuboid(RAIL_HALF_WIDTH, RAIL_HEIGHT, hl)
					.setFriction(RAIL_FRICTION)
					.setRestitution(RAIL_RESTITUTION),
				rBody,
			);
			this.bodies.push(rBody);
		}

		return true;
	}

	/** Remove all bodies from the world. */
	dispose(): void {
		for (const b of this.bodies) this.world.removeRigidBody(b);
		this.bodies = [];
		this.lastHash = "";
	}
}
