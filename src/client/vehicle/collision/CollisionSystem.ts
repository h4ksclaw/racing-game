/**
 * CollisionSystem — 3D collision detection and response.
 *
 * Uses GJK for intersection testing and EPA for penetration info.
 * Applies impulse-based response with 3D angular velocity.
 *
 * Pure math module. No Three.js dependency.
 */

import { transformHull } from "./ConvexHull.ts";
import { epa } from "./EPA.ts";
import { gjk } from "./GJK.ts";
import type { Vec3 } from "./Vec3.ts";
import { v3Add, v3Cross, v3Dot, v3LenSq, v3Normalize, v3Scale, v3Sub } from "./Vec3.ts";

/** A rigid body for collision purposes. */
export interface RigidBody {
	/** Position (center of mass) */
	pos: Vec3;
	/** Velocity */
	vel: Vec3;
	/** Angular velocity (rad/s) — roll(X), pitch(Y), yaw(Z) */
	angVel: Vec3;
	/** Mass (kg) */
	mass: number;
	/** Inverse mass (1/mass) */
	invMass: number;
	/** Inverse inertia tensor diagonal (1/Ix, 1/Iy, 1/Iz) */
	invInertia: Vec3;
	/** Convex hull vertices (local space) */
	hull: Vec3[];
	/** Restitution (bounciness) 0-1 */
	restitution: number;
	/** Friction coefficient */
	friction: number;
}

export interface CollisionResult {
	/** Normal pointing from B to A */
	normal: Vec3;
	/** Penetration depth */
	depth: number;
	/** Contact point in world space */
	contactPoint: Vec3;
	/** Relative velocity at contact point */
	relativeVel: Vec3;
}

const DEFAULT_RESTITUTION = 0.3;
const DEFAULT_FRICTION = 0.4;

/**
 * Check collision between two rigid bodies.
 * Returns null if no collision detected.
 */
export function checkPair(bodyA: RigidBody, bodyB: RigidBody): CollisionResult | null {
	// Transform hulls to world space (axis-aligned for now)
	const worldA = transformHull(bodyA.hull, bodyA.pos, 1, 0);
	const worldB = transformHull(bodyB.hull, bodyB.pos, 1, 0);

	const result = gjk(worldA, worldB);
	if (!result.intersecting) return null;

	// Use EPA to get penetration info
	// Compute relative velocity for better normal selection
	const relVel = v3Sub(bodyA.vel, bodyB.vel);
	const epaResult = epa(result.simplex, worldA, worldB, relVel);
	if (epaResult.depth < 1e-6) return null;

	// Compute relative velocity at contact point
	const rA = v3Sub(epaResult.contactPoint, bodyA.pos);
	const rB = v3Sub(epaResult.contactPoint, bodyB.pos);

	// Velocity at contact: v + ω × r
	const velA = v3Add(bodyA.vel, v3Cross(bodyA.angVel, rA));
	const velB = v3Add(bodyB.vel, v3Cross(bodyB.angVel, rB));
	const relativeVel = v3Sub(velA, velB);

	return {
		normal: epaResult.normal,
		depth: epaResult.depth,
		contactPoint: epaResult.contactPoint,
		relativeVel,
	};
}

/**
 * Resolve a collision between two bodies using impulse-based response.
 * Modifies bodyA and bodyB in place.
 */
export function resolveCollision(
	result: CollisionResult,
	bodyA: RigidBody,
	bodyB: RigidBody,
): void {
	let { normal, depth, contactPoint, relativeVel } = result;

	// Ensure normal points from B to A
	if (v3Dot(normal, v3Sub(bodyA.pos, bodyB.pos)) < 0) {
		normal = v3Scale(normal, -1);
	}

	// Separate bodies (push apart proportional to inverse mass)
	const totalInvMass = bodyA.invMass + bodyB.invMass;
	if (totalInvMass < 1e-10) return;

	const sep = v3Scale(normal, depth / totalInvMass);
	bodyA.pos = v3Add(bodyA.pos, v3Scale(sep, bodyA.invMass));
	bodyB.pos = v3Sub(bodyB.pos, v3Scale(sep, bodyB.invMass));

	// Relative velocity along normal
	const velAlongNormal = v3Dot(relativeVel, normal);

	// Only resolve if objects are moving toward each other
	if (velAlongNormal > 0) return;

	// Restitution
	const e = Math.min(bodyA.restitution, bodyB.restitution);

	// Impulse magnitude (with rotational contribution)
	const rA = v3Sub(contactPoint, bodyA.pos);
	const rB = v3Sub(contactPoint, bodyB.pos);

	const rAxN = v3Cross(rA, normal);
	const rBxN = v3Cross(rB, normal);

	const angA =
		rAxN.x * rAxN.x * bodyA.invInertia.x +
		rAxN.y * rAxN.y * bodyA.invInertia.y +
		rAxN.z * rAxN.z * bodyA.invInertia.z;
	const angB =
		rBxN.x * rBxN.x * bodyB.invInertia.x +
		rBxN.y * rBxN.y * bodyB.invInertia.y +
		rBxN.z * rBxN.z * bodyB.invInertia.z;

	const denominator = totalInvMass + angA + angB;
	if (denominator < 1e-10) return;

	const j = (-(1 + e) * velAlongNormal) / denominator;

	// Apply linear impulse
	const impulse = v3Scale(normal, j);
	bodyA.vel = v3Add(bodyA.vel, v3Scale(impulse, bodyA.invMass));
	bodyB.vel = v3Sub(bodyB.vel, v3Scale(impulse, bodyB.invMass));

	// Apply angular impulse: Δω = I⁻¹ × (r × J)
	const torqueA = v3Cross(rA, impulse);
	const torqueB = v3Cross(rB, impulse);
	bodyA.angVel = v3Add(bodyA.angVel, {
		x: torqueA.x * bodyA.invInertia.x,
		y: torqueA.y * bodyA.invInertia.y,
		z: torqueA.z * bodyA.invInertia.z,
	});
	bodyB.angVel = v3Sub(bodyB.angVel, {
		x: torqueB.x * bodyB.invInertia.x,
		y: torqueB.y * bodyB.invInertia.y,
		z: torqueB.z * bodyB.invInertia.z,
	});

	// Friction impulse (tangential)
	const tangent = v3Sub(relativeVel, v3Scale(normal, velAlongNormal));
	const tangentLen = v3LenSq(tangent);
	if (tangentLen > 1e-10) {
		const tangentNorm = v3Normalize(tangent);
		const rAxT = v3Cross(rA, tangentNorm);
		const rBxT = v3Cross(rB, tangentNorm);
		const angAT =
			rAxT.x * rAxT.x * bodyA.invInertia.x +
			rAxT.y * rAxT.y * bodyA.invInertia.y +
			rAxT.z * rAxT.z * bodyA.invInertia.z;
		const angBT =
			rBxT.x * rBxT.x * bodyB.invInertia.x +
			rBxT.y * rBxT.y * bodyB.invInertia.y +
			rBxT.z * rBxT.z * bodyB.invInertia.z;
		const denomT = totalInvMass + angAT + angBT;
		if (denomT > 1e-10) {
			let jt = -v3Dot(relativeVel, tangentNorm) / denomT;
			const mu = Math.sqrt(bodyA.friction * bodyB.friction);
			if (Math.abs(jt) > j * mu) {
				jt = j * mu * Math.sign(jt);
			}
			const fricImpulse = v3Scale(tangentNorm, jt);
			bodyA.vel = v3Add(bodyA.vel, v3Scale(fricImpulse, bodyA.invMass));
			bodyB.vel = v3Sub(bodyB.vel, v3Scale(fricImpulse, bodyB.invMass));

			const fTorqueA = v3Cross(rA, fricImpulse);
			const fTorqueB = v3Cross(rB, fricImpulse);
			bodyA.angVel = v3Add(bodyA.angVel, {
				x: fTorqueA.x * bodyA.invInertia.x,
				y: fTorqueA.y * bodyA.invInertia.y,
				z: fTorqueA.z * bodyA.invInertia.z,
			});
			bodyB.angVel = v3Sub(bodyB.angVel, {
				x: fTorqueB.x * bodyB.invInertia.x,
				y: fTorqueB.y * bodyB.invInertia.y,
				z: fTorqueB.z * bodyB.invInertia.z,
			});
		}
	}
}

/**
 * Check collision with ground plane (Y = groundY).
 */
export function checkGround(body: RigidBody, groundY: number): CollisionResult | null {
	let minY = Infinity;
	for (const v of body.hull) {
		const worldY = v.y + body.pos.y;
		if (worldY < minY) minY = worldY;
	}

	const penetration = groundY - minY;
	if (penetration <= 0) return null;

	const normal: Vec3 = { x: 0, y: 1, z: 0 };
	const contactPoint: Vec3 = { x: body.pos.x, y: groundY, z: body.pos.z };

	return {
		normal,
		depth: penetration,
		contactPoint,
		relativeVel: body.vel,
	};
}

/**
 * Resolve ground collision for a single body.
 */
export function resolveGround(result: CollisionResult, body: RigidBody): void {
	// Push body up
	body.pos = { ...body.pos, y: body.pos.y + result.depth };

	// Velocity along normal
	const velAlongNormal = v3Dot(body.vel, result.normal);
	if (velAlongNormal >= 0) return;

	// Bounce
	const e = body.restitution;
	body.vel = { ...body.vel, y: body.vel.y - (1 + e) * velAlongNormal };

	// Friction (tangential)
	const tangent: Vec3 = { x: body.vel.x, y: 0, z: body.vel.z };
	const tangentSpeed = Math.sqrt(v3LenSq(tangent));
	if (tangentSpeed > 1e-10) {
		const tangentNorm = v3Normalize(tangent);
		const frictionForce = body.friction * Math.abs(velAlongNormal);
		const reduction = Math.min(frictionForce, tangentSpeed);
		body.vel = {
			...body.vel,
			x: body.vel.x - tangentNorm.x * reduction,
			z: body.vel.z - tangentNorm.z * reduction,
		};
	}

	// Ground contact damps angular velocity
	body.angVel = v3Scale(body.angVel, 0.98);
}

/**
 * Create a RigidBody from chassis specs.
 */
export function createBody(params: {
	mass: number;
	halfExtents: [number, number, number];
	pos: Vec3;
	restitution?: number;
	friction?: number;
}): RigidBody {
	const mass = params.mass;
	const [hw, hh, hd] = params.halfExtents;
	return {
		pos: { ...params.pos },
		vel: { x: 0, y: 0, z: 0 },
		angVel: { x: 0, y: 0, z: 0 },
		mass,
		invMass: mass > 0 ? 1 / mass : 0,
		invInertia: {
			x: mass > 0 ? 12 / (mass * (hh * hh + hd * hd)) : 0,
			y: mass > 0 ? 12 / (mass * (hw * hw + hd * hd)) : 0,
			z: mass > 0 ? 12 / (mass * (hw * hw + hh * hh)) : 0,
		},
		hull: [
			{ x: -hw, y: -hh, z: -hd },
			{ x: hw, y: -hh, z: -hd },
			{ x: hw, y: hh, z: -hd },
			{ x: -hw, y: hh, z: -hd },
			{ x: -hw, y: -hh, z: hd },
			{ x: hw, y: -hh, z: hd },
			{ x: hw, y: hh, z: hd },
			{ x: -hw, y: hh, z: hd },
		],
		restitution: params.restitution ?? DEFAULT_RESTITUTION,
		friction: params.friction ?? DEFAULT_FRICTION,
	};
}
