/**
 * Terrain trimesh collider for Rapier.
 *
 * Builds a grid of triangles sampled from TerrainProvider.getHeight(),
 * centered on the car and rebuilt when the car moves far enough.
 * At 2m resolution over 200m: 101×101 = ~10K vertices, ~20K triangles.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import type { TerrainProvider } from "./types.ts";

/** Patch configuration. */
export const TERRAIN_PATCH = {
	/** Patch size in meters (square). 200m = 100m in each direction. */
	SIZE: 200,
	/** Grid resolution in meters per cell. 2m = smooth enough for road driving. */
	RESOLUTION: 2,
	/** Rebuild when car moves this far from patch center. */
	REBUILD_DIST: 60,
	/** Extra margin beyond patch edge before forcing rebuild. */
	EDGE_MARGIN: 30,
	/** Vertical offset added to getHeight() results to account for physics surface. */
	HEIGHT_OFFSET: 0.3,
} as const;

/**
 * Build a trimesh from a terrain grid.
 * Creates a (cols+1)×(rows+1) vertex grid over [minX..maxX] × [minZ..maxZ],
 * samples getHeight at each vertex, then triangulates into two triangles per cell.
 */
export function buildTerrainTrimesh(
	terrain: TerrainProvider,
	centerX: number,
	centerZ: number,
	size: number,
	resolution: number,
): { vertices: Float32Array; indices: Uint32Array } {
	const cols = Math.ceil(size / resolution);
	const rows = Math.ceil(size / resolution);
	const vertexCount = (cols + 1) * (rows + 1);
	const vertices = new Float32Array(vertexCount * 3);
	const indices = new Uint32Array(cols * rows * 6);

	const halfSize = size / 2;
	const minX = centerX - halfSize;
	const minZ = centerZ - halfSize;
	const step = size / cols;

	// Fill vertices
	let vi = 0;
	for (let row = 0; row <= rows; row++) {
		const z = minZ + row * step;
		for (let col = 0; col <= cols; col++) {
			const x = minX + col * step;
			const y = terrain.getHeight(x, z);
			vertices[vi++] = x;
			vertices[vi++] = y + TERRAIN_PATCH.HEIGHT_OFFSET;
			vertices[vi++] = z;
		}
	}

	// Fill indices (two triangles per cell)
	let ii = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const tl = row * (cols + 1) + col;
			const tr = tl + 1;
			const bl = tl + (cols + 1);
			const br = bl + 1;
			indices[ii++] = tl;
			indices[ii++] = bl;
			indices[ii++] = tr;
			indices[ii++] = tr;
			indices[ii++] = bl;
			indices[ii++] = br;
		}
	}

	return { vertices, indices };
}

/**
 * Manages the terrain trimesh collider in a Rapier world.
 * Handles creation, removal, and rebuilding of the ground patch.
 */
export class TerrainCollider {
	private world: RAPIER.World;
	private terrain: TerrainProvider;
	private groundBody: RAPIER.RigidBody | null = null;
	private _patchCenterX = Number.POSITIVE_INFINITY;
	private _patchCenterZ = Number.POSITIVE_INFINITY;

	constructor(world: RAPIER.World, terrain: TerrainProvider) {
		this.world = world;
		this.terrain = terrain;
	}

	get patchCenterX(): number {
		return this._patchCenterX;
	}
	get patchCenterZ(): number {
		return this._patchCenterZ;
	}

	/** Whether the car needs a ground patch rebuild. */
	needsRebuild(carX: number, carZ: number): boolean {
		const dx = carX - this._patchCenterX;
		const dz = carZ - this._patchCenterZ;
		const distFromCenter = Math.sqrt(dx * dx + dz * dz);
		const distFromEdge = TERRAIN_PATCH.SIZE / 2 - distFromCenter;
		return distFromCenter > TERRAIN_PATCH.REBUILD_DIST || distFromEdge < TERRAIN_PATCH.EDGE_MARGIN;
	}

	/** Rebuild the terrain trimesh at the given center position. */
	rebuild(cx: number, cz: number): void {
		if (this.groundBody) {
			this.world.removeRigidBody(this.groundBody);
			this.groundBody = null;
		}

		const { vertices, indices } = buildTerrainTrimesh(
			this.terrain,
			cx,
			cz,
			TERRAIN_PATCH.SIZE,
			TERRAIN_PATCH.RESOLUTION,
		);

		this.groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
		this.world.createCollider(
			RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8).setRestitution(0.0),
			this.groundBody,
		);

		this._patchCenterX = cx;
		this._patchCenterZ = cz;
	}

	/** Remove all bodies from the world. */
	dispose(): void {
		if (this.groundBody) {
			this.world.removeRigidBody(this.groundBody);
			this.groundBody = null;
		}
	}
}
