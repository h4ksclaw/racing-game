/**
 * Procedural track generation using spline-based curves.
 */

import { CatmullRomCurve3, type Mesh, Vector3 } from "three";

export class TrackGenerator {
	/**
	 * Generate a track from control points.
	 * Returns road mesh and barrier positions.
	 */
	generate(controlPoints: Vector3[], width = 10): { roadMesh: Mesh | null; barriers: Vector3[] } {
		const curve = new CatmullRomCurve3(controlPoints, true);
		const points = curve.getPoints(200);

		// TODO: Build BufferGeometry from vertices, create mesh with road material
		// TODO: Generate physics trimesh from vertices
		// TODO: Place barriers along track edges

		const barriers: Vector3[] = [];
		for (const p of points) {
			barriers.push(p.clone().add(new Vector3(0, 1, 0)));
		}

		void width; // used in future implementation
		return { roadMesh: null, barriers };
	}
}
