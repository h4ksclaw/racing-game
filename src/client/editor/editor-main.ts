/**
 * Three.js scene setup for the car editor viewport.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getEditorState, setShowDims, setWireframe } from "./editor-state.js";
import { frameModel as frameModelImpl, type LoadOptions, loadGLB as loadGLBImpl } from "./model-loading.js";
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
let refPrism: THREE.Mesh | null = null;
let refDims = { length: 4.5, width: 1.8, height: 1.4 };

export type EditorMode = "orbit" | "select" | "place" | "move" | "delete" | "assign";
let currentMode: EditorMode = "select";
let modeChangeCallback: ((mode: EditorMode) => void) | null = null;
let selectedObjectUUID: string | null = null;
let selectionChangeCallback: ((uuid: string | null) => void) | null = null;
let highlightsVisible = true; // whether marked-object highlights are shown

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

/** Get the X-center of the current model's bounding box (for symmetry mirroring). */
export function getModelCenter(): THREE.Vector3 {
	if (!currentModel) return new THREE.Vector3();
	const box = new THREE.Box3().setFromObject(currentModel);
	return box.getCenter(new THREE.Vector3());
}

export function getMode() {
	return currentMode;
}
export function isWireframe() {
	return getEditorState().wireframe;
}
export function isShowingDims() {
	return getEditorState().showDims;
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
	if (currentMode === "select" && mode !== "select" && selectedObjectUUID && currentModel) {
		unhighlightObjectInternal(selectedObjectUUID);
	}
	currentMode = mode;
	orbitControls.enabled = mode === "orbit" || mode === "select" || mode === "assign";
	transformControls.getHelper().visible = mode === "move";
	if (mode !== "move") transformControls.detach();
	modeChangeCallback?.(mode);
}

export function onModeChange(cb: (mode: EditorMode) => void) {
	modeChangeCallback = cb;
}

/** Set wireframe on all mesh materials in the model. */
export function applyWireframe(model: THREE.Object3D, value: boolean) {
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
	const value = !getEditorState().wireframe;
	setWireframe(value);
	if (currentModel) applyWireframe(currentModel, value);
	return value;
}

export function toggleDims() {
	const value = !getEditorState().showDims;
	setShowDims(value);
	return value;
}

/** Update the reference prism to show a specific car's dimensions. */
export function setRefPrismDims(length: number, width: number, height: number) {
	refDims = { length, width, height };
	if (!scene || !refPrism) return;
	scene.remove(refPrism);
	const geo = new THREE.BoxGeometry(width, height, length);
	const mat = new THREE.MeshBasicMaterial({
		color: 0x5c9eff,
		wireframe: true,
		transparent: true,
		opacity: 0.15,
	});
	refPrism = new THREE.Mesh(geo, mat);
	refPrism.name = "__ref_car";
	refPrism.position.set(0, height / 2, 0);
	scene.add(refPrism);
	console.log(`[editor] Reference prism updated: ${length}m × ${width}m × ${height}m`);
}

export function setModelScale(sx: number, sy: number, sz: number) {
	if (currentModel) currentModel.scale.set(sx, sy, sz);
}

/** Explode or reassemble the model. */
export function setExploded(exploded: boolean, factor = 1.5): void {
	if (!currentModel) return;
	const modelBox = new THREE.Box3().setFromObject(currentModel);
	const modelCenter = modelBox.getCenter(new THREE.Vector3());
	currentModel.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const mesh = child as THREE.Mesh;
		if (!mesh.geometry || !mesh.geometry.boundingBox) return;
		const meshCenter = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
		if (exploded) {
			if (!mesh.userData._origPos) mesh.userData._origPos = mesh.position.clone();
			const dir = new THREE.Vector3().subVectors(meshCenter, modelCenter);
			const len = dir.length();
			if (len > 0.001) dir.normalize().multiplyScalar(factor);
			else dir.set(0, factor, 0);
			mesh.position.copy(dir);
		} else {
			const orig = mesh.userData._origPos;
			if (orig) {
				mesh.position.copy(orig);
				delete mesh.userData._origPos;
			}
		}
	});
	currentModel.updateMatrixWorld(true);
}

/** Load a GLB model — delegates to model-loading.ts. */
export function loadGLB(url: string, options?: LoadOptions): Promise<THREE.Group> {
	return loadGLBImpl(
		{
			scene,
			camera,
			orbitControls,
			gltfLoader,
			gridHelper,
			wireframe: getEditorState().wireframe,
			onApplyWireframe: applyWireframe,
			onModelLoaded: (model) => {
				currentModel = model;
				scene.add(model);
			},
		},
		url,
		options,
	);
}

/** Frame camera to fit current model. */
export function frameModel() {
	if (!currentModel) return;
	frameModelImpl(
		{
			scene,
			camera,
			orbitControls,
			gltfLoader,
			gridHelper,
			wireframe: false,
			onApplyWireframe: applyWireframe,
			onModelLoaded: () => {},
		},
		currentModel,
	);
}

function highlightObjectInternal(uuid: string) {
	if (currentModel && highlightsVisible) highlightObject(currentModel, uuid);
}
function unhighlightObjectInternal(uuid: string) {
	if (currentModel) unhighlightObject(currentModel, uuid);
}

/** Toggle visibility of all marked-object highlights (wheels, brake discs, lights).
 *  When turned on, re-highlights all currently marked meshes.
 *  When turned off, removes all highlights. */
export function toggleHighlights(): boolean {
	highlightsVisible = !highlightsVisible;
	if (!currentModel) return highlightsVisible;
	currentModel.traverse((child) => {
		if (!(child as THREE.Mesh).isMesh) return;
		const marked = child.userData.markedAs as string | undefined;
		if (!marked) return;
		if (highlightsVisible) {
			highlightObject(currentModel!, child.uuid);
		} else {
			unhighlightObject(currentModel!, child.uuid);
		}
	});
	return highlightsVisible;
}

export function areHighlightsVisible() {
	return highlightsVisible;
}

/** Ensure highlights are marked as visible (sync after manual mark operations). */
export function ensureHighlightsVisible() {
	if (!highlightsVisible) highlightsVisible = true;
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
		setSelectedObjectUUID(intersects[0].object.uuid);
	} else {
		setSelectedObjectUUID(null);
	}
	return true;
}

let _renderCallbacks: Array<() => void> = [];

/** Register a callback to run every frame in the render loop. */
export function onRenderFrame(cb: () => void): () => void {
	_renderCallbacks.push(cb);
	return () => {
		_renderCallbacks = _renderCallbacks.filter((f) => f !== cb);
	};
}

export function init(container: HTMLElement) {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x11131c);

	camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
	camera.position.set(3, 2, 4);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.shadowMap.enabled = true;
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
	gridHelper = new THREE.GridHelper(20, 40, 0x2e3550, 0x191d2a);
	gridHelper.material.opacity = 0.5;
	gridHelper.material.transparent = true;
	scene.add(gridHelper);

	// World axes
	const axesHelper = new THREE.AxesHelper(2);
	axesHelper.setColors(new THREE.Color(0xff4444), new THREE.Color(0x44ff44), new THREE.Color(0x5c9eff));
	scene.add(axesHelper);

	// Reference prism
	const geo = new THREE.BoxGeometry(refDims.width, refDims.height, refDims.length);
	const mat = new THREE.MeshBasicMaterial({
		color: 0x5c9eff,
		wireframe: true,
		transparent: true,
		opacity: 0.15,
	});
	refPrism = new THREE.Mesh(geo, mat);
	refPrism.name = "__ref_car";
	refPrism.position.set(0, refDims.height / 2, 0);
	scene.add(refPrism);
	console.log(`[editor] Reference prism: ${refDims.length}m × ${refDims.width}m × ${refDims.height}m`);

	// Controls
	orbitControls = new OrbitControls(camera, renderer.domElement);
	orbitControls.enableDamping = true;
	orbitControls.dampingFactor = 0.1;
	orbitControls.enableZoom = true;
	orbitControls.zoomSpeed = 1.2;
	orbitControls.minDistance = 0.01;
	orbitControls.maxDistance = 10000;
	orbitControls.enableRotate = true;
	orbitControls.enablePan = true;

	renderer.domElement.addEventListener(
		"wheel",
		(_e) => {
			// Wheel events handled by OrbitControls — no action needed
		},
		{ passive: true },
	);

	transformControls = new TransformControls(camera, renderer.domElement);
	transformControls.addEventListener("dragging-changed", (e) => {
		orbitControls.enabled = !e.value;
	});
	scene.add(transformControls.getHelper());

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

	// Sidebar resize handle
	const sidebar = document.getElementById("sidebar");
	const sidebarResize = document.getElementById("sidebar-resize");
	if (sidebar && sidebarResize) {
		let isDragging = false;
		const onMouseDown = (e: MouseEvent) => {
			isDragging = true;
			sidebarResize.classList.add("active");
			e.preventDefault();
		};
		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			const newWidth = Math.max(220, Math.min(500, e.clientX));
			sidebar.style.width = newWidth + "px";
			sidebarResize.style.left = newWidth + "px";
		};
		const onMouseUp = () => {
			if (!isDragging) return;
			isDragging = false;
			sidebarResize.classList.remove("active");
		};
		sidebarResize.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	}

	// Render loop
	(function animate() {
		requestAnimationFrame(animate);
		for (const cb of _renderCallbacks) cb();
		orbitControls.update();
		renderer.render(scene, camera);
	})();
}
