/**
 * Model loading — GLB loading, auto-scaling, centering, flattening, camera framing.
 * Extracted from editor-main.ts to reduce its size.
 */
import * as THREE from "three";

export interface LoadOptions {
	/** Real-world dimensions in meters. If provided, model is auto-scaled to match. */
	dims?: { length_m: number; width_m: number; height_m: number };
}

export interface ModelLoadContext {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	orbitControls: { target: THREE.Vector3; update(): void };
	gltfLoader: import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
	gridHelper: THREE.GridHelper;
	wireframe: boolean;
	onModelLoaded: (model: THREE.Group) => void;
	onApplyWireframe: (model: THREE.Object3D, value: boolean) => void;
}

/**
 * Compute a robust bounding box that ignores outlier meshes.
 * Strategy: compute per-mesh world bboxes, take the union, then check if
 * any single mesh is responsible for a disproportionate amount of the extent.
 * If removing it shrinks an axis by >40%, exclude it and recompute.
 */
export function robustBBoxSize(model: THREE.Group): THREE.Vector3 {
	const meshBoxes: THREE.Box3[] = [];
	model.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		if (!mesh.geometry) return;
		const wb = new THREE.Box3().setFromObject(mesh);
		const s = wb.getSize(new THREE.Vector3());
		if (s.x > 0.01 || s.y > 0.01 || s.z > 0.01) {
			meshBoxes.push(wb);
		}
	});

	if (meshBoxes.length <= 1) {
		return new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
	}

	const fullUnion = new THREE.Box3();
	for (const wb of meshBoxes) fullUnion.union(wb);
	const fullSize = fullUnion.getSize(new THREE.Vector3());

	const exclude = new Set<number>();
	for (const axis of ["x", "y", "z"] as const) {
		for (let i = 0; i < meshBoxes.length; i++) {
			if (exclude.has(i)) continue;
			const partial = new THREE.Box3();
			for (let j = 0; j < meshBoxes.length; j++) {
				if (j === i || exclude.has(j)) continue;
				partial.union(meshBoxes[j]);
			}
			const partialSize = partial.getSize(new THREE.Vector3());
			if (fullSize[axis] > 0 && partialSize[axis] / fullSize[axis] < 0.6) {
				exclude.add(i);
				break;
			}
		}
	}

	const result = new THREE.Box3();
	for (let i = 0; i < meshBoxes.length; i++) {
		if (!exclude.has(i)) result.union(meshBoxes[i]);
	}
	const finalSize = result.getSize(new THREE.Vector3());
	console.log(
		`[editor] robustBBox: ${meshBoxes.length} meshes, ${exclude.size} excluded, raw=${fullSize.x.toFixed(1)}x${fullSize.y.toFixed(1)}x${fullSize.z.toFixed(1)}, robust=${finalSize.x.toFixed(2)}x${finalSize.y.toFixed(2)}x${finalSize.z.toFixed(2)}`,
	);
	const longestRobust = Math.max(finalSize.x, finalSize.y, finalSize.z);
	if (longestRobust > 20) {
		console.log(
			`[editor] ⚠ Model is ${longestRobust.toFixed(0)} units long — likely in centimeters (should be ~4m for a car). Select a car from the search panel to auto-scale.`,
		);
	} else if (longestRobust > 200) {
		console.log(
			`[editor] ⚠ Model is ${longestRobust.toFixed(0)} units long — likely in millimeters. Select a car to auto-scale.`,
		);
	}
	return finalSize;
}

export function loadGLB(ctx: ModelLoadContext, url: string, options?: LoadOptions): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		ctx.gltfLoader.load(
			url,
			(gltf) => {
				let model = gltf.scene;

				// Center model on grid
				const box = new THREE.Box3().setFromObject(model);
				const center = box.getCenter(new THREE.Vector3());
				model.position.sub(center);
				model.position.y += box.min.y * -1;

				// Auto-scale
				const size = robustBBoxSize(model);
				const modelLongest = Math.max(size.x, size.y, size.z);

				if (options?.dims) {
					const realLongest = Math.max(options.dims.length_m, options.dims.width_m, options.dims.height_m);
					if (modelLongest > 0) {
						const ratio = modelLongest / realLongest;
						const scale = ratio > 2.0 || ratio < 0.5 ? 1.0 / ratio : 1.0;
						console.log(
							`[editor] auto-scale (from car DB): modelLongest=${modelLongest.toFixed(3)}, real=${realLongest}, ratio=${ratio.toFixed(2)}, scale=${scale.toFixed(4)}`,
						);
						model.scale.set(scale, scale, scale);
					}
				} else {
					if (modelLongest > 15) {
						console.log(
							`[editor] auto-normalize: model is ${modelLongest.toFixed(1)} units (cm?), scaling by 0.01 → ${(modelLongest * 0.01).toFixed(2)}m`,
						);
						model.scale.set(0.01, 0.01, 0.01);
					} else if (modelLongest >= 500) {
						console.log(`[editor] auto-normalize: model is ${modelLongest.toFixed(1)} units (mm?), scaling by 0.001`);
						model.scale.set(0.001, 0.001, 0.001);
					} else {
						console.log(`[editor] No target dims — loading at native scale (${modelLongest.toFixed(2)} units)`);
					}
				}

				model.updateMatrixWorld(true);

				// Flatten hierarchy — bake world transforms into geometry
				const flatGroup = new THREE.Group();
				flatGroup.name = model.name || "__flattened";
				const toReparent: THREE.Object3D[] = [];
				model.traverse((child) => {
					if ((child as THREE.Mesh).isMesh && child !== model) toReparent.push(child);
				});
				for (const mesh of toReparent) {
					(mesh as THREE.Mesh).updateWorldMatrix(true, false);
					const wm = (mesh as THREE.Mesh).matrixWorld.clone();
					(mesh as THREE.Mesh).geometry.applyMatrix4(wm);
					mesh.position.set(0, 0, 0);
					mesh.rotation.set(0, 0, 0);
					mesh.scale.set(1, 1, 1);
					flatGroup.add(mesh);
				}
				const sceneIdx = ctx.scene.children.indexOf(model);
				if (sceneIdx >= 0) ctx.scene.children[sceneIdx] = flatGroup;
				model = flatGroup;
				model.updateMatrixWorld(true);

				// Clean centering after flatten
				const cleanBox = new THREE.Box3().setFromObject(model);
				const cleanCenter = cleanBox.getCenter(new THREE.Vector3());
				model.position.set(-cleanCenter.x, -cleanBox.min.y, -cleanCenter.z);
				model.updateMatrixWorld(true);

				const verifyBox = new THREE.Box3().setFromObject(model);
				console.log(
					`[editor] After flatten+center: y=[${verifyBox.min.y.toFixed(2)},${verifyBox.max.y.toFixed(2)}] x=[${verifyBox.min.x.toFixed(2)},${verifyBox.max.x.toFixed(2)}] z=[${verifyBox.min.z.toFixed(2)},${verifyBox.max.z.toFixed(2)}]`,
				);

				const frameSize = robustBBoxSize(model);

				// Auto-resize grid
				const gridSpan = Math.max(frameSize.x, frameSize.z) * 4;
				ctx.scene.remove(ctx.gridHelper);
				const newGrid = new THREE.GridHelper(gridSpan, gridSpan * 2, 0x2e3550, 0x191d2a);
				(newGrid.material as THREE.Material).opacity = 0.5;
				(newGrid.material as THREE.Material).transparent = true;
				ctx.scene.add(newGrid);

				// Frame camera
				const maxDim = Math.max(frameSize.x, frameSize.y, frameSize.z);
				const dist = maxDim * 2;
				ctx.camera.position.set(dist * 0.5, dist * 0.4, dist * 0.8);
				ctx.orbitControls.target.set(0, frameSize.y * 0.3, 0);
				ctx.orbitControls.update();
				console.log(
					`[editor] Camera framed: pos=${ctx.camera.position.x.toFixed(1)},${ctx.camera.position.y.toFixed(1)},${ctx.camera.position.z.toFixed(1)} target=${ctx.orbitControls.target.x.toFixed(1)},${ctx.orbitControls.target.y.toFixed(1)},${ctx.orbitControls.target.z.toFixed(1)} dist=${dist.toFixed(1)} modelSize=${frameSize.x.toFixed(2)}x${frameSize.y.toFixed(2)}x${frameSize.z.toFixed(2)}`,
				);

				if (ctx.wireframe) ctx.onApplyWireframe(model, ctx.wireframe);

				ctx.onModelLoaded(model);
				resolve(model);
			},
			undefined,
			reject,
		);
	});
}

/** Frame the camera to fit the current model. */
export function frameModel(ctx: ModelLoadContext, model: THREE.Group): void {
	const frameSize = robustBBoxSize(model);
	const maxDim = Math.max(frameSize.x, frameSize.y, frameSize.z);
	const dist = maxDim * 2;
	ctx.camera.position.set(dist * 0.5, dist * 0.4, dist * 0.8);
	ctx.orbitControls.target.set(0, frameSize.y * 0.3, 0);
	ctx.orbitControls.update();
}
