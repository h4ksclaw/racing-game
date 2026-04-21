/**
 * Three.js scene setup for the car editor viewport.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { highlightObject, unhighlightObject } from "./object-manager.js";

export const API_BASE = "/api";

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let orbitControls: OrbitControls;
let transformControls: TransformControls;
let gridHelper: THREE.GridHelper;
let gltfLoader: GLTFLoader;
let currentModel: THREE.Group | null = null;
let wireframe = false;
let showDims = false;

export type EditorMode = "orbit" | "select" | "place" | "move" | "delete";
let currentMode: EditorMode = "orbit";
let modeChangeCallback: ((mode: EditorMode) => void) | null = null;
let selectedObjectUUID: string | null = null;
let selectionChangeCallback: ((uuid: string | null) => void) | null = null;

export function getScene() {
	return scene;
}
export function getCamera() {
	return camera;
}
export function getRenderer() {
	return renderer;
}
export function getOrbitControls() {
	return orbitControls;
}
export function getTransformControls() {
	return transformControls;
}
export function getGLTFLoader() {
	return gltfLoader;
}
export function getCurrentModel() {
	return currentModel;
}
export function getMode() {
	return currentMode;
}
export function isWireframe() {
	return wireframe;
}
export function isShowingDims() {
	return showDims;
}
export function getSelectedObjectUUID() {
	return selectedObjectUUID;
}
export function setSelectedObjectUUID(uuid: string | null) {
	const prev = selectedObjectUUID;
	if (prev && currentModel) unhighlightObjectInternal(prev);
	selectedObjectUUID = uuid;
	if (uuid && currentModel) highlightObjectInternal(uuid);
	selectionChangeCallback?.(uuid);
}
export function onSelectionChange(cb: (uuid: string | null) => void) {
	selectionChangeCallback = cb;
}

export function setMode(mode: EditorMode) {
	// Unhighlight previous selection if leaving select mode
	if (currentMode === "select" && mode !== "select" && selectedObjectUUID && currentModel) {
		unhighlightObjectInternal(selectedObjectUUID);
	}
	currentMode = mode;
	orbitControls.enabled = mode === "orbit" || mode === "select";
	// TransformControls extends Object3D but TS types don't reflect that in this version
	(transformControls as unknown as THREE.Object3D).visible = mode === "move";
	if (mode !== "move") transformControls.detach();
	modeChangeCallback?.(mode);
}

export function onModeChange(cb: (mode: EditorMode) => void) {
	modeChangeCallback = cb;
}

/** Set wireframe on all mesh materials in the model. */
function applyWireframe(model: THREE.Object3D, value: boolean) {
	model.traverse((c) => {
		const mesh = c as THREE.Mesh;
		if (!mesh.isMesh) return;
		const mat = mesh.material;
		if (Array.isArray(mat)) {
			for (const m of mat) {
				if ("wireframe" in m) (m as THREE.MeshStandardMaterial).wireframe = value;
			}
		} else if ("wireframe" in mat) {
			(mat as THREE.MeshStandardMaterial).wireframe = value;
		}
	});
}

export function toggleWireframe() {
	wireframe = !wireframe;
	if (currentModel) applyWireframe(currentModel, wireframe);
	return wireframe;
}

export function toggleDims() {
	showDims = !showDims;
	return showDims;
}

export function setModelScale(sx: number, sy: number, sz: number) {
	if (currentModel) {
		currentModel.scale.set(sx, sy, sz);
	}
}

export function loadGLB(url: string): Promise<THREE.Group> {
	return new Promise((resolve, reject) => {
		gltfLoader.load(
			url,
			(gltf) => {
				const model = gltf.scene;
				if (currentModel) scene.remove(currentModel);
				currentModel = model;
				scene.add(model);

				// Center model on grid
				const box = new THREE.Box3().setFromObject(model);
				const center = box.getCenter(new THREE.Vector3());
				model.position.sub(center);
				model.position.y += box.min.y * -1;

				// Frame camera to fit model
				const size = box.getSize(new THREE.Vector3());
				const maxDim = Math.max(size.x, size.y, size.z);
				const dist = maxDim * 2;
				camera.position.set(dist * 0.5, dist * 0.4, dist * 0.8);
				orbitControls.target.set(0, maxDim * 0.3, 0);
				orbitControls.update();

				if (wireframe) applyWireframe(model, true);

				resolve(model);
			},
			undefined,
			reject,
		);
	});
}

function highlightObjectInternal(uuid: string) {
	if (currentModel) highlightObject(currentModel, uuid);
}
function unhighlightObjectInternal(uuid: string) {
	if (currentModel) unhighlightObject(currentModel, uuid);
}

/** Handle raycast-based object selection in select mode. Returns true if handled. */
export function handleSelectClick(event: MouseEvent): boolean {
	if (currentMode !== "select" || !currentModel) return false;

	const rect = renderer.domElement.getBoundingClientRect();
	const mouse = new THREE.Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-((event.clientY - rect.top) / rect.height) * 2 + 1,
	);

	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObject(currentModel, true);

	if (intersects.length > 0) {
		const obj = intersects[0].object;
		setSelectedObjectUUID(obj.uuid);
	} else {
		setSelectedObjectUUID(null);
	}
	return true;
}

export function init(container: HTMLElement) {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0a0a0f);

	camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
	camera.position.set(3, 2, 4);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);

	// Lights
	const ambient = new THREE.AmbientLight(0x404060, 1.5);
	scene.add(ambient);
	const dir = new THREE.DirectionalLight(0xffffff, 2);
	dir.position.set(5, 10, 7);
	dir.castShadow = true;
	dir.shadow.mapSize.set(2048, 2048);
	scene.add(dir);
	const fill = new THREE.DirectionalLight(0x8888ff, 0.5);
	fill.position.set(-5, 3, -5);
	scene.add(fill);

	// Grid
	gridHelper = new THREE.GridHelper(20, 40, 0x1e1e2e, 0x14141e);
	scene.add(gridHelper);

	// Controls
	orbitControls = new OrbitControls(camera, renderer.domElement);
	orbitControls.enableDamping = true;
	orbitControls.dampingFactor = 0.1;
	orbitControls.minDistance = 0.5;
	orbitControls.maxDistance = 50;

	transformControls = new TransformControls(camera, renderer.domElement);
	transformControls.addEventListener("dragging-changed", (e) => {
		orbitControls.enabled = !e.value;
	});
	scene.add(transformControls as unknown as THREE.Object3D);

	gltfLoader = new GLTFLoader();

	// Resize
	function onResize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}
	window.addEventListener("resize", onResize);
	onResize();

	// Render loop
	(function animate() {
		requestAnimationFrame(animate);
		orbitControls.update();
		renderer.render(scene, camera);
	})();
}
