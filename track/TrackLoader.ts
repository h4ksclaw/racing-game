/**
 * Load GLB track models and generate physics colliders from them.
 */

import type { Group, Scene } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class TrackLoader {
	private loader = new GLTFLoader();

	/**
	 * Load a track GLB and add it to the scene.
	 * Returns the track scene root.
	 */
	async loadTrack(url: string, scene: Scene): Promise<Group> {
		const gltf = await this.loader.loadAsync(url);
		const trackScene = gltf.scene;
		scene.add(trackScene);

		// TODO: Traverse trackScene and generate physics colliders from meshes
		// - Road surface: static trimesh
		// - Barriers: static box/convex hull
		// - Decorations: no colliders

		return trackScene; // Group, not Scene
	}
}
