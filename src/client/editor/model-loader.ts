/**
 * Lazy model loader — fetches GLB files from the S3 proxy.
 *
 * Deduplicates in-flight loads for the same key.
 */

import type * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const inflight = new Map<string, Promise<THREE.Group>>();

/** Load a GLB model from S3 via the server proxy. Deduplicates concurrent requests. */
export function loadModelFromS3(s3Key: string): Promise<THREE.Group> {
	const cached = inflight.get(s3Key);
	if (cached) return cached;

	const promise = _loadModelFromS3(s3Key).finally(() => inflight.delete(s3Key));
	inflight.set(s3Key, promise);
	return promise;
}

async function _loadModelFromS3(s3Key: string): Promise<THREE.Group> {
	const url = `/api/s3/${encodeURIComponent(s3Key)}`;
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(url);
	return gltf.scene;
}
