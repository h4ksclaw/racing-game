/**
 * Wireframe debug renderer for Rapier physics.
 *
 * Renders two layers via LineSegments:
 *   1. World colliders (yellow, semi-transparent) — terrain + guardrails from world.debugRender()
 *   2. Car body (green) — from known RigidBody ref
 *
 * Guardrails are NOT drawn separately — they're already included in debugRender()
 * as part of the physics world. One system, no duplicates.
 */

import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const MAX_VERTS = 600_000;

export class RapierDebugRenderer {
	private worldMesh: THREE.LineSegments;
	private carMesh: THREE.LineSegments;
	private logCount = 0;

	constructor(scene: THREE.Scene) {
		this.worldMesh = this.createLine(scene, 0xffff00, 0.4);
		this.carMesh = this.createLine(scene, 0x22ff44, 0.9);
	}

	update(world: RAPIER.World, carBody?: RAPIER.RigidBody): void {
		this.logCount++;
		try {
			const buf = world.debugRender();
			if (!buf || buf.vertices.length === 0) {
				if (this.logCount <= 3) console.log("[rapier-debug] no debug data");
				this.worldMesh.visible = false;
				this.carMesh.visible = false;
				return;
			}

			this.worldMesh.visible = true;
			const numVerts = Math.min(buf.vertices.length / 3, MAX_VERTS);
			this.replaceGeometry(this.worldMesh, buf.vertices.slice(0, numVerts * 3));

			// Car body in green
			if (carBody) {
				const carVerts = this.buildCuboidWireframes([carBody]);
				if (carVerts.length > 0) {
					this.replaceGeometry(this.carMesh, carVerts);
					this.carMesh.visible = true;
				} else {
					this.carMesh.visible = false;
				}
			} else {
				this.carMesh.visible = false;
			}

			if (this.logCount <= 3) {
				const p = buf.vertices;
				console.log(
					`[rapier-debug] ${numVerts} verts, ` +
						`line1: [${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}]→[${p[3].toFixed(1)},${p[4].toFixed(1)},${p[5].toFixed(1)}]`,
				);
			}
		} catch (e) {
			console.error("[rapier-debug] error:", e);
		}
	}

	/**
	 * Build wireframe edges for cuboid colliders on the given bodies.
	 * Each cuboid → 12 edges (24 vertices).
	 */
	private buildCuboidWireframes(bodies: readonly RAPIER.RigidBody[]): Float32Array {
		const verts: number[] = [];
		for (const body of bodies) {
			const pos = body.translation();
			const rot = body.rotation();
			const { x: qx, y: qy, z: qz, w: qw } = rot;
			const xx = qx * qx;
			const yy = qy * qy;
			const zz = qz * qz;
			const xy = qx * qy;
			const xz = qx * qz;
			const yz = qy * qz;
			const wx = qw * qx;
			const wy = qw * qy;
			const wz = qw * qz;
			// Column-major 3x3 rotation matrix from quaternion
			const m = [
				1 - 2 * (yy + zz),
				2 * (xy - wz),
				2 * (xz + wy),
				2 * (xy + wz),
				1 - 2 * (xx + zz),
				2 * (yz - wx),
				2 * (xz - wy),
				2 * (yz + wx),
				1 - 2 * (xx + yy),
			];

			for (let ci = 0; ci < body.numColliders(); ci++) {
				const collider = body.collider(ci);
				if (!collider) continue;
				const shape = collider.shape;
				if (!shape) continue;

				let hx = 0.5;
				let hy = 0.5;
				let hz = 0.5;
				const getHalfExtents = (shape as unknown as { getHalfExtents(): { x: number; y: number; z: number } })
					.getHalfExtents;
				if (typeof getHalfExtents === "function") {
					const he = getHalfExtents();
					hx = he.x;
					hy = he.y;
					hz = he.z;
				}

				const corners: number[][] = [
					[-hx, -hy, -hz],
					[hx, -hy, -hz],
					[hx, hy, -hz],
					[-hx, hy, -hz],
					[-hx, -hy, hz],
					[hx, -hy, hz],
					[hx, hy, hz],
					[-hx, hy, hz],
				];

				const transformed = corners.map(([cx, cy, cz]) => [
					m[0] * cx + m[3] * cy + m[6] * cz + pos.x,
					m[1] * cx + m[4] * cy + m[7] * cz + pos.y,
					m[2] * cx + m[5] * cy + m[8] * cz + pos.z,
				]);

				// 12 edges of a cuboid
				const edges: [number, number][] = [
					[0, 1],
					[1, 2],
					[2, 3],
					[3, 0],
					[4, 5],
					[5, 6],
					[6, 7],
					[7, 4],
					[0, 4],
					[1, 5],
					[2, 6],
					[3, 7],
				];

				for (const [a, b] of edges) {
					verts.push(...transformed[a], ...transformed[b]);
				}
			}
		}
		return new Float32Array(verts);
	}

	private replaceGeometry(mesh: THREE.LineSegments, positions: Float32Array): void {
		const oldGeom = mesh.geometry;
		const newGeom = new THREE.BufferGeometry();
		newGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		mesh.geometry = newGeom;
		oldGeom.dispose();
	}

	private createLine(scene: THREE.Scene, color: number, opacity: number): THREE.LineSegments {
		const geom = new THREE.BufferGeometry();
		const mat = new THREE.LineBasicMaterial({
			color,
			depthTest: false,
			transparent: true,
			opacity,
		});
		const mesh = new THREE.LineSegments(geom, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = 999;
		scene.add(mesh);
		return mesh;
	}

	dispose(): void {
		this.worldMesh.geometry.dispose();
		this.carMesh.geometry.dispose();
	}
}
