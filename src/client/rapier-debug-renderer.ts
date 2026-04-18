/**
 * Renders Rapier physics colliders as Three.js wireframes in-world.
 *
 * Uses Rapier's built-in debugRenderPipeline to get vertices+colors,
 * then builds a single LineSegments mesh updated each frame.
 *
 * Rapier's debug colors:
 *   Red/orange  — dynamic bodies (car chassis)
 *   Green       — fixed bodies (ground trimesh, guardrails)
 *   Blue        — kinematic bodies
 */

import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const MAX_VERTS = 500_000;

export class RapierDebugRenderer {
	private lines: THREE.LineSegments;
	private geometry: THREE.BufferGeometry;
	private positions: Float32Array;
	private colors: Float32Array;

	constructor(scene: THREE.Scene) {
		this.positions = new Float32Array(MAX_VERTS * 3);
		this.colors = new Float32Array(MAX_VERTS * 3);
		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
		this.geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));

		const mat = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: false,
			transparent: true,
			opacity: 0.8,
		});

		this.lines = new THREE.LineSegments(this.geometry, mat);
		this.lines.frustumCulled = false;
		scene.add(this.lines);
	}

	/** Update wireframe mesh from Rapier world. Call after physics step. */
	private frameCount = 0;

	update(world: RAPIER.World): void {
		const buffers = world.debugRender();
		const verts = buffers.vertices;
		const cols = buffers.colors;
		const vertCount = Math.min(verts.length / 3, MAX_VERTS);

		// Log once to confirm we're getting data
		if (this.frameCount < 3) {
			console.log(`[debug-render] frame ${this.frameCount}: ${vertCount} verts`);
			this.frameCount++;
		}

		for (let i = 0; i < vertCount; i++) {
			this.positions[i * 3] = verts[i * 3];
			this.positions[i * 3 + 1] = verts[i * 3 + 1];
			this.positions[i * 3 + 2] = verts[i * 3 + 2];

			this.colors[i * 3] = cols[i * 3];
			this.colors[i * 3 + 1] = cols[i * 3 + 1];
			this.colors[i * 3 + 2] = cols[i * 3 + 2];
		}

		// Zero stale verts beyond current data
		const clearEnd = Math.min(vertCount * 3 + 300, this.positions.length);
		for (let i = vertCount * 3; i < clearEnd; i++) {
			this.positions[i] = 0;
			this.colors[i] = 0;
		}

		(this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
		(this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
		this.geometry.setDrawRange(0, vertCount);
	}

	dispose(): void {
		this.geometry.dispose();
	}
}
