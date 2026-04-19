/**
 * Wireframe debug renderer for Rapier physics.
 *
 * Uses world.debugRender() with filterPredicate to separate colliders into
 * three color-coded layers — all positions come directly from Rapier:
 *   1. Terrain trimesh (yellow) — the ground surface
 *   2. Guardrails (red) — wall cuboids along road edges, Y-clamped to ground level
 *   3. Car body (green) — the player vehicle collider
 */

import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const MAX_VERTS = 600_000;

/** Clamp guardrail wireframe Y to this range around the car (meters). */
const GUARD_Y_RANGE = 5;

export class RapierDebugRenderer {
	private terrainMesh: THREE.LineSegments;
	private guardMesh: THREE.LineSegments;
	private carMesh: THREE.LineSegments;
	private logCount = 0;

	constructor(scene: THREE.Scene) {
		this.terrainMesh = this.createLine(scene, 0xffff00, 0.4);
		this.guardMesh = this.createLine(scene, 0xff2222, 0.9);
		this.carMesh = this.createLine(scene, 0x22ff44, 0.9);
	}

	update(world: RAPIER.World, carBody?: RAPIER.RigidBody, guardBodies?: readonly RAPIER.RigidBody[]): void {
		this.logCount++;
		try {
			// Build lookup sets for filter predicates
			const guardBodySet = new Set<RAPIER.RigidBody>(guardBodies ?? []);

			// Terrain: everything EXCEPT car and guardrails
			const terrainBuf = world.debugRender(undefined, (collider) => {
				const body = collider.parent();
				if (!body) return true;
				if (body === carBody) return false;
				if (guardBodySet.has(body)) return false;
				return true;
			});

			// Guardrails: only guardrail bodies
			const guardBuf =
				guardBodySet.size > 0
					? world.debugRender(undefined, (collider) => {
							const body = collider.parent();
							return body != null && guardBodySet.has(body);
						})
					: null;

			// Car: only the car body
			const carBuf = carBody ? world.debugRender(undefined, (collider) => collider.parent() === carBody) : null;

			// Update terrain (yellow) — pass through as-is
			if (terrainBuf && terrainBuf.vertices.length > 0) {
				const n = Math.min(terrainBuf.vertices.length / 3, MAX_VERTS);
				this.replaceGeometry(this.terrainMesh, terrainBuf.vertices.slice(0, n * 3));
				this.terrainMesh.visible = true;
			} else {
				this.terrainMesh.visible = false;
			}

			// Update guardrails (red) — clamp Y to ground-level band around car
			if (guardBuf && guardBuf.vertices.length > 0) {
				const carY = carBody?.translation().y ?? 0;
				const minY = carY - GUARD_Y_RANGE;
				const maxY = carY + GUARD_Y_RANGE;
				const src = guardBuf.vertices;
				// Filter: keep line segments where at least one vertex is in Y range
				const filtered: number[] = [];
				for (let i = 0; i + 5 < src.length; i += 6) {
					const y0 = src[i + 1];
					const y1 = src[i + 4];
					if ((y0 >= minY && y0 <= maxY) || (y1 >= minY && y1 <= maxY)) {
						filtered.push(
							src[i],
							Math.max(minY, Math.min(maxY, y0)),
							src[i + 2],
							src[i + 3],
							Math.max(minY, Math.min(maxY, y1)),
							src[i + 5],
						);
					}
				}
				if (filtered.length > 0) {
					this.replaceGeometry(this.guardMesh, new Float32Array(filtered));
					this.guardMesh.visible = true;
				} else {
					this.guardMesh.visible = false;
				}
			} else {
				this.guardMesh.visible = false;
			}

			// Update car (green) — pass through as-is
			if (carBuf && carBuf.vertices.length > 0) {
				this.replaceGeometry(this.carMesh, carBuf.vertices);
				this.carMesh.visible = true;
			} else {
				this.carMesh.visible = false;
			}

			if (this.logCount <= 3) {
				const tv = terrainBuf?.vertices.length ?? 0;
				const gv = guardBuf?.vertices.length ?? 0;
				const cv = carBuf?.vertices.length ?? 0;
				console.log(`[rapier-debug] terrain: ${tv / 3}, guardrails: ${gv / 3}, car: ${cv / 3} verts`);
				if (guardBuf && guardBuf.vertices.length > 6) {
					console.log(
						"[rapier-debug] first guardrail verts:",
						Array.from({ length: Math.min(9, guardBuf.vertices.length) }, (_, i) => guardBuf.vertices[i].toFixed(2)),
					);
				}
			}
		} catch (e) {
			console.error("[rapier-debug] error:", e);
		}
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
		this.terrainMesh.geometry.dispose();
		this.guardMesh.geometry.dispose();
		this.carMesh.geometry.dispose();
	}
}
