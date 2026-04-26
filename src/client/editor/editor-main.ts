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

export type EditorMode = "orbit" | "select" | "place" | "move" | "delete" | "assign" | "face-select";
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
	orbitControls.enabled = mode === "orbit" || mode === "select" || mode === "assign" || mode === "face-select";
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
}

export function setModelScale(sx: number, sy: number, sz: number) {
	if (currentModel) currentModel.scale.set(sx, sy, sz);
}

/**
 * Split selected mesh into separate meshes by disconnected geometry (loose parts).
 * Like Blender's "Separate by Loose Parts".
 * Returns the number of new meshes created (0 if nothing to split).
 */
export function splitSelectedMesh(): number {
	if (!currentModel) return 0;
	const uuid = getSelectedObjectUUID();
	if (!uuid) return 0;

	// Walk scene to find the mesh by UUID
	const targetMeshRef: { mesh: THREE.Mesh | null } = { mesh: null };
	currentModel.traverse((child) => {
		if (child.uuid === uuid && (child as THREE.Mesh).isMesh) {
			targetMeshRef.mesh = child as THREE.Mesh;
		}
	});
	const mesh = targetMeshRef.mesh;
	if (!mesh) return 0;
	// Sanity: must have geometry with indexed triangles
	const geom = mesh.geometry;
	if (!geom.index || !geom.attributes.position) return 0;

	const posAttr = geom.attributes.position;
	const indexAttr = geom.index;
	const triCount = indexAttr.count / 3;

	// Build edge→triangle adjacency to find connected components via shared edges
	// Each triangle has 3 edges: (v0,v1), (v1,v2), (v0,v2)
	// Edge key: encode (min,max) as min * (vertCount+1) + max
	function edgeKey(a: number, b: number): number {
		return a < b ? a * (posAttr.count + 1) + b : b * (posAttr.count + 1) + a;
	}

	const edgeToTris = new Map<number, number[]>();
	for (let t = 0; t < triCount; t++) {
		const i0 = indexAttr.getX(t * 3);
		const i1 = indexAttr.getX(t * 3 + 1);
		const i2 = indexAttr.getX(t * 3 + 2);
		const keys = [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i0, i2)];
		for (const k of keys) {
			let list = edgeToTris.get(k);
			if (!list) { list = []; edgeToTris.set(k, list); }
			list.push(t);
		}
	}

	// Flood-fill connected components
	const component = new Int32Array(triCount).fill(-1);
	let numComponents = 0;
	const stack: number[] = [];
	for (let t = 0; t < triCount; t++) {
		if (component[t] !== -1) continue;
		component[t] = numComponents;
		stack.push(t);
		while (stack.length > 0) {
			const cur = stack.pop()!;
			const v0 = indexAttr.getX(cur * 3);
			const v1 = indexAttr.getX(cur * 3 + 1);
			const v2 = indexAttr.getX(cur * 3 + 2);
			const keys = [edgeKey(v0, v1), edgeKey(v1, v2), edgeKey(v0, v2)];
			for (const k of keys) {
				const neighbors = edgeToTris.get(k);
				if (neighbors) {
					for (const nt of neighbors) {
						if (component[nt] === -1) {
							component[nt] = numComponents;
							stack.push(nt);
						}
					}
				}
			}
		}
		numComponents++;
	}

	if (numComponents <= 1) return 0;

	const parent = mesh.parent;
	if (!parent) return 0;

	// Split into separate meshes, one per component
	const triCounts = new Array<number>(numComponents).fill(0);
	for (let t = 0; t < triCount; t++) triCounts[component[t]]++;

	// Save original local transform — each split piece inherits it
	const origPos = mesh.position.clone();
	const origQuat = mesh.quaternion.clone();
	const origScale = mesh.scale.clone();

	// Clear selection before removing the mesh (so unhighlight can still find it)
	setSelectedObjectUUID(null);
	// Remove the original mesh from parent
	const origIndex = parent.children.indexOf(mesh);
	parent.remove(mesh);

	// Preserve userData, material reference
	const origUserData = { ...mesh.userData };
	const origMaterial = mesh.material;

	for (let c = 0; c < numComponents; c++) {
		const newGeom = new THREE.BufferGeometry();
		const vertSet = new Set<number>();
		const newIndices: number[] = [];

		for (let t = 0; t < triCount; t++) {
			if (component[t] !== c) continue;
			newIndices.push(
				indexAttr.getX(t * 3),
				indexAttr.getX(t * 3 + 1),
				indexAttr.getX(t * 3 + 2),
			);
			vertSet.add(indexAttr.getX(t * 3));
			vertSet.add(indexAttr.getX(t * 3 + 1));
			vertSet.add(indexAttr.getX(t * 3 + 2));
		}

		// Build old→new vertex index mapping
		const sortedVerts = [...vertSet].sort((a, b) => a - b);
		const oldToNew = new Map<number, number>();
		for (let i = 0; i < sortedVerts.length; i++) oldToNew.set(sortedVerts[i], i);

		// Copy position attribute
		const newPos = new Float32Array(sortedVerts.length * 3);
		for (let i = 0; i < sortedVerts.length; i++) {
			newPos[i * 3] = posAttr.getX(sortedVerts[i]);
			newPos[i * 3 + 1] = posAttr.getY(sortedVerts[i]);
			newPos[i * 3 + 2] = posAttr.getZ(sortedVerts[i]);
		}
		newGeom.setAttribute("position", new THREE.BufferAttribute(newPos, 3));

		// Copy normal attribute if present
		if (geom.attributes.normal) {
			const srcNorm = geom.attributes.normal;
			const newNorm = new Float32Array(sortedVerts.length * 3);
			for (let i = 0; i < sortedVerts.length; i++) {
				newNorm[i * 3] = srcNorm.getX(sortedVerts[i]);
				newNorm[i * 3 + 1] = srcNorm.getY(sortedVerts[i]);
				newNorm[i * 3 + 2] = srcNorm.getZ(sortedVerts[i]);
			}
			newGeom.setAttribute("normal", new THREE.BufferAttribute(newNorm, 3));
		}

		// Copy UV attribute if present
		if (geom.attributes.uv) {
			const srcUv = geom.attributes.uv;
			const newUv = new Float32Array(sortedVerts.length * 2);
			for (let i = 0; i < sortedVerts.length; i++) {
				newUv[i * 2] = srcUv.getX(sortedVerts[i]);
				newUv[i * 2 + 1] = srcUv.getY(sortedVerts[i]);
			}
			newGeom.setAttribute("uv", new THREE.BufferAttribute(newUv, 2));
		}

		// Remap indices
		const remappedIndices = newIndices.map((idx) => oldToNew.get(idx)!);
		newGeom.setIndex(remappedIndices);
		newGeom.computeBoundingSphere();
		newGeom.computeBoundingBox();

		// Create new mesh with cloned material (so highlights don't leak)
		const newMesh = new THREE.Mesh(newGeom, origMaterial as THREE.Material);
		newMesh.name = mesh.name + (numComponents > 2 ? `_part${c + 1}` : (c === 0 ? "" : "_2"));
		// Keep the same local transform as the original — geometry stays in local space
		newMesh.position.copy(origPos);
		newMesh.quaternion.copy(origQuat);
		newMesh.scale.copy(origScale);
		// Clear any markings on split pieces — user will re-assign
		delete newMesh.userData.markedAs;
		newMesh.userData._splitFrom = mesh.uuid;
		// Copy other userData except markedAs
		for (const key of Object.keys(origUserData)) {
			if (key !== "markedAs" && key !== "_prevEmissive") {
				newMesh.userData[key] = origUserData[key];
			}
		}

		parent.add(newMesh);
		// Insert at same position as original
		parent.children.splice(parent.children.indexOf(newMesh), 1);
		parent.children.splice(origIndex + c, 0, newMesh);
	}

	currentModel.updateMatrixWorld(true);
	geom.dispose();

	console.log(`[editor] Split "${mesh.name}" into ${numComponents} parts (${triCount} tris)`);
	return numComponents - 1; // number of NEW meshes created
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
	// Sync face-select overlay visibility
	import("./face-select.js").then(({ setOverlayVisible }) => {
		setOverlayVisible(highlightsVisible);
	});
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
		const hitMesh = intersects[0].object as THREE.Mesh;
		setSelectedObjectUUID(hitMesh.uuid);
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

/** Trigger a renderer resize (call after layout changes like sidebar show/hide). */
let _resizeFn: (() => void) | null = null;
export function triggerResize() {
	_resizeFn?.();
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
		if (w > 0 && h > 0) {
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		}
	}
	window.addEventListener("resize", onResize);
	onResize();
	_resizeFn = onResize;
	// Safety: re-run resize after first paint in case layout wasn't ready
	requestAnimationFrame(() => requestAnimationFrame(() => onResize()));

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
			// Move viewport and toolbar to match sidebar width
			const vp = document.getElementById("viewport");
			if (vp) {
				vp.style.left = newWidth + "px";
				vp.style.width = `calc(100% - ${newWidth}px)`;
			}
			const tb = document.getElementById("toolbar");
			if (tb) tb.style.left = (newWidth + 14) + "px";
		};
		const onMouseUp = () => {
			if (!isDragging) return;
			isDragging = false;
			sidebarResize.classList.remove("active");
			// Trigger renderer resize after drag ends
			_resizeFn?.();
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
