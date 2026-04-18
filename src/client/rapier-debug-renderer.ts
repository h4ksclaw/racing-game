/**
 * Renders Rapier physics colliders as Three.js wireframes in-world.
 * Uses Rapier's debugRenderPipeline → vertices+colors → LineSegments.
 */

import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const MAX_VERTS = 600_000;

export class RapierDebugRenderer {
	private mesh: THREE.LineSegments;
	private pos: Float32Array;
	private col: Float32Array;
	private posAttr: THREE.BufferAttribute;
	private colAttr: THREE.BufferAttribute;
	private updateCount = 0;

	constructor(scene: THREE.Scene) {
		this.pos = new Float32Array(MAX_VERTS * 3);
		this.col = new Float32Array(MAX_VERTS * 3);

		const geom = new THREE.BufferGeometry();
		this.posAttr = new THREE.Float32BufferAttribute(this.pos, 3);
		this.colAttr = new THREE.Float32BufferAttribute(this.col, 3);
		geom.setAttribute("position", this.posAttr);
		geom.setAttribute("color", this.colAttr);

		const mat = new THREE.LineBasicMaterial({
			vertexColors: true,
			depthTest: false,
			transparent: true,
			opacity: 0.85,
		});

		this.mesh = new THREE.LineSegments(geom, mat);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 999;

		// Magenta cross at world origin — proves the renderer is in the scene
		const cross = new THREE.BufferGeometry();
		cross.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(new Float32Array([0, 0, -10, 0, 0, 10, -10, 0, 0, 10, 0, 0]), 3),
		);
		scene.add(new THREE.LineSegments(cross, new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false })));

		scene.add(this.mesh);
		console.log("[rapier-debug] constructor done, added to scene");
	}

	update(world: RAPIER.World): void {
		this.updateCount++;
		if (this.updateCount <= 3) {
			console.log(`[rapier-debug] update #${this.updateCount}`);
		}

		let vertCount = 0;
		try {
			const buf = world.debugRender();
			vertCount = Math.min(buf.vertices.length / 3, MAX_VERTS);

			for (let i = 0; i < vertCount; i++) {
				const i3 = i * 3;
				this.pos[i3] = buf.vertices[i3];
				this.pos[i3 + 1] = buf.vertices[i3 + 1];
				this.pos[i3 + 2] = buf.vertices[i3 + 2];
				this.col[i3] = buf.colors[i3];
				this.col[i3 + 1] = buf.colors[i3 + 1];
				this.col[i3 + 2] = buf.colors[i3 + 2];
			}
		} catch (e) {
			console.error("[rapier-debug] debugRender error:", e);
		}

		if (this.updateCount <= 3) {
			// Log bounding box of debug verts to diagnose offset
			let minY = Infinity,
				maxY = -Infinity,
				minX = Infinity,
				maxX = -Infinity,
				minZ = Infinity,
				maxZ = -Infinity;
			for (let i = 0; i < vertCount; i++) {
				const x = this.pos[i * 3],
					y = this.pos[i * 3 + 1],
					z = this.pos[i * 3 + 2];
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
			console.log(
				`[rapier-debug] bbox: x[${minX.toFixed(1)},${maxX.toFixed(1)}] y[${minY.toFixed(1)},${maxY.toFixed(1)}] z[${minZ.toFixed(1)},${maxZ.toFixed(1)}]`,
			);
			console.log(`[rapier-debug] ${vertCount} collider verts`);
		}

		// Zero stale verts
		const end = Math.min(vertCount * 3 + 600, this.pos.length);
		for (let i = vertCount * 3; i < end; i++) {
			this.pos[i] = 0;
			this.col[i] = 0;
		}

		this.posAttr.needsUpdate = true;
		this.colAttr.needsUpdate = true;
		this.mesh.geometry.setDrawRange(0, vertCount);
	}

	dispose(): void {
		this.mesh.geometry.dispose();
	}
}
