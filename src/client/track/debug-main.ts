import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ProceduralTrack } from "./ProceduralTrack";
import { buildTrackScene } from "./TrackSceneBuilder";

// biome-ignore lint/style/noNonNullAssertion: guaranteed by HTML template
const infoEl = document.getElementById("info")!;

// ── Renderer ──────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── State ─────────────────────────────────────────────────────────────
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let _trackGroup: THREE.Group;
let dispose: () => void;

function generate() {
	const seed = Number((document.getElementById("seed") as HTMLInputElement).value) || 42;
	const numPoints = Number((document.getElementById("numPoints") as HTMLInputElement).value) || 14;
	const width = Number((document.getElementById("width") as HTMLInputElement).value) || 12;
	const elevation = Number((document.getElementById("elevation") as HTMLInputElement).value) || 40;
	const tightness = Number((document.getElementById("tightness") as HTMLInputElement).value) || 5;
	const downhill = Number((document.getElementById("downhill") as HTMLInputElement).value) || 60;

	// Clean up previous
	if (dispose) dispose();
	if (controls) controls.dispose();

	const gen = new ProceduralTrack(seed, {
		numPoints,
		width,
		elevation,
		tightness,
		downhillBias: downhill,
	});
	const data = gen.generate();
	const result = buildTrackScene(data);

	scene = result.scene;
	camera = result.camera;
	_trackGroup = result.trackGroup;
	dispose = result.dispose;

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.target.copy(data.samples[0].point);

	infoEl.textContent = `Seed: ${seed} | Length: ${data.length.toFixed(0)}m | Samples: ${data.numSamples} | CPs: ${data.numControlPoints} | Elev: ${data.elevationRange.min.toFixed(1)}…${data.elevationRange.max.toFixed(1)} | Scenery: ${data.scenery.length}`;
}

// ── UI wiring ─────────────────────────────────────────────────────────
document.getElementById("generateBtn")?.addEventListener("click", generate);
document.getElementById("randomBtn")?.addEventListener("click", () => {
	(document.getElementById("seed") as HTMLInputElement).value = String(
		Math.floor(Math.random() * 100000),
	);
	generate();
});

// ── Render loop ───────────────────────────────────────────────────────
function animate() {
	requestAnimationFrame(animate);
	if (controls) controls.update();
	if (scene && camera) renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
	if (camera) {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
	}
	renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Go ────────────────────────────────────────────────────────────────
generate();
animate();
