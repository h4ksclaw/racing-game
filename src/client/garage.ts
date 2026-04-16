import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	applyOverrides,
	extractTunable,
	loadCustomConfig,
	saveCustomConfig,
	type TunableConfig,
} from "./ui/garage-store.ts";
import { SPORTS_CAR } from "./vehicle/types.ts";

// ── URL params ──────────────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
function preserveParams(baseUrl: string, extra?: Record<string, string>): string {
	const u = new URL(baseUrl, window.location.origin);
	for (const [k, v] of urlParams) {
		if (k !== "car") u.searchParams.set(k, v);
	}
	if (extra) {
		for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
	}
	return u.toString();
}

// ── Nav links ───────────────────────────────────────────────────────────
const navPractice = document.getElementById("nav-practice") as HTMLAnchorElement | null;
const navWorld = document.getElementById("nav-world") as HTMLAnchorElement | null;
const btnDrive = document.getElementById("btn-drive");
const btnBack = document.getElementById("btn-back");

if (navPractice) navPractice.href = preserveParams("/practice");
if (navWorld) navWorld.href = preserveParams("/world");
if (btnDrive)
	btnDrive.addEventListener("click", () => {
		window.location.href = preserveParams("/practice", { car: "custom" });
	});
if (btnBack)
	btnBack.addEventListener("click", () => {
		window.location.href = preserveParams("/world");
	});

// ── Current config ──────────────────────────────────────────────────────
const baseConfig = SPORTS_CAR;
const saved = loadCustomConfig();
const activeConfig = saved ? applyOverrides(baseConfig, saved) : baseConfig;
const currentTunable: TunableConfig = extractTunable(activeConfig);

// ── Three.js scene ──────────────────────────────────────────────────────
const canvas = document.getElementById("viewer-canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08060f);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4, 2.5, 5);

const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.autoRotate = true;
orbitControls.autoRotateSpeed = 1.2;
orbitControls.target.set(0, 0.5, 0);
orbitControls.minDistance = 2;
orbitControls.maxDistance = 15;

// Lighting
const hemi = new THREE.HemisphereLight(0x8b5cf6, 0x1a0a2e, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(5, 8, 4);
scene.add(dir);

const ambient = new THREE.AmbientLight(0x3b2070, 0.4);
scene.add(ambient);

// Ground plane (subtle grid)
const gridHelper = new THREE.GridHelper(20, 40, 0x1a1030, 0x0f0a1a);
scene.add(gridHelper);

// Load car model
async function loadModel(): Promise<void> {
	try {
		const gltf = await import("three/examples/jsm/loaders/GLTFLoader.js");
		const loader = new gltf.GLTFLoader();
		const result = await loader.loadAsync(activeConfig.modelPath);
		const model = result.scene;

		const scale = activeConfig.modelScale;
		model.scale.set(scale, scale, scale);
		model.traverse((child) => {
			if ((child as THREE.Mesh).isMesh) {
				const mesh = child as THREE.Mesh;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
			}
		});

		scene.add(model);

		// Center the model
		const box = new THREE.Box3().setFromObject(model);
		const center = box.getCenter(new THREE.Vector3());
		model.position.sub(center);
		model.position.y -= box.min.y * scale;
	} catch (err) {
		console.warn("Failed to load car model:", err);
	}
}

loadModel();

// Render loop
function animate(): void {
	requestAnimationFrame(animate);
	orbitControls.update();
	renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Sidebar UI ──────────────────────────────────────────────────────────
const sidebar = document.getElementById("sidebar");

interface FieldDef {
	key: string;
	path: string;
	label: string;
	min?: number;
	max?: number;
	step?: number;
}

interface SectionDef {
	id: string;
	title: string;
	fields: FieldDef[];
}

const sections: SectionDef[] = [
	{
		id: "engine",
		title: "Engine",
		fields: [
			{
				key: "torqueNm",
				path: "engine.torqueNm",
				label: "Torque (Nm)",
				min: 20,
				max: 500,
				step: 1,
			},
			{ key: "idleRPM", path: "engine.idleRPM", label: "Idle RPM", min: 500, max: 1500, step: 50 },
			{ key: "maxRPM", path: "engine.maxRPM", label: "Max RPM", min: 4000, max: 10000, step: 100 },
			{
				key: "redlinePct",
				path: "engine.redlinePct",
				label: "Redline %",
				min: 0.7,
				max: 0.95,
				step: 0.01,
			},
			{
				key: "finalDrive",
				path: "engine.finalDrive",
				label: "Final Drive",
				min: 1.0,
				max: 6.0,
				step: 0.1,
			},
			{
				key: "engineBraking",
				path: "engine.engineBraking",
				label: "Engine Braking",
				min: 0,
				max: 1,
				step: 0.01,
			},
		],
	},
	{
		id: "gearbox",
		title: "Gearbox",
		fields: [
			...baseConfig.gearbox.gearRatios.map((_, i) => ({
				key: `gear${i}`,
				path: `gearbox.gearRatios.${i}`,
				label: `${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"} Gear`,
				step: 0.01,
			})),
			{
				key: "shiftTime",
				path: "gearbox.shiftTime",
				label: "Shift Time (s)",
				min: 0.05,
				max: 0.5,
				step: 0.01,
			},
		],
	},
	{
		id: "brakes",
		title: "Brakes",
		fields: [
			{
				key: "maxBrakeG",
				path: "brakes.maxBrakeG",
				label: "Max Brake G",
				min: 0.3,
				max: 2.0,
				step: 0.05,
			},
			{
				key: "handbrakeG",
				path: "brakes.handbrakeG",
				label: "Handbrake G",
				min: 0.3,
				max: 2.5,
				step: 0.05,
			},
			{
				key: "brakeBias",
				path: "brakes.brakeBias",
				label: "Brake Bias",
				min: 0.4,
				max: 0.7,
				step: 0.01,
			},
		],
	},
	{
		id: "tires",
		title: "Tires",
		fields: [
			{
				key: "corneringStiffnessFront",
				path: "tires.corneringStiffnessFront",
				label: "Front Cornering Stiff.",
				step: 100,
			},
			{
				key: "corneringStiffnessRear",
				path: "tires.corneringStiffnessRear",
				label: "Rear Cornering Stiff.",
				step: 100,
			},
			{
				key: "peakFriction",
				path: "tires.peakFriction",
				label: "Peak Friction",
				min: 0.5,
				max: 2.0,
				step: 0.05,
			},
			{
				key: "tractionPct",
				path: "tires.tractionPct",
				label: "Traction %",
				min: 0.2,
				max: 0.8,
				step: 0.01,
			},
		],
	},
	{
		id: "drag",
		title: "Drag",
		fields: [
			{
				key: "rollingResistance",
				path: "drag.rollingResistance",
				label: "Rolling Resistance",
				step: 0.1,
			},
			{ key: "aeroDrag", path: "drag.aeroDrag", label: "Aero Drag", step: 0.01 },
		],
	},
	{
		id: "chassis",
		title: "Chassis",
		fields: [
			{ key: "mass", path: "chassis.mass", label: "Mass (kg)", min: 50, max: 3000, step: 10 },
			{
				key: "maxSteerAngle",
				path: "chassis.maxSteerAngle",
				label: "Max Steer Angle",
				step: 0.01,
			},
			{
				key: "suspensionStiffness",
				path: "chassis.suspensionStiffness",
				label: "Susp. Stiffness",
				step: 1,
			},
			{ key: "cgHeight", path: "chassis.cgHeight", label: "CG Height", step: 0.01 },
			{
				key: "weightFront",
				path: "chassis.weightFront",
				label: "Weight Front %",
				min: 0.4,
				max: 0.65,
				step: 0.01,
			},
		],
	},
];

function getNestedValue(obj: unknown, path: string): number {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined) return 0;
		if (Array.isArray(current)) {
			current = current[Number.parseInt(part, 10)];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}
	return typeof current === "number" ? current : 0;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: number): void {
	const parts = path.split(".");
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		const next = current[part];
		if (next === undefined || next === null) {
			const newVal: Record<string, unknown> = {};
			current[part] = newVal;
			current = newVal;
		} else {
			current = next as Record<string, unknown>;
		}
	}
	current[parts[parts.length - 1]] = value;
}

function drawTorqueCurve(): void {
	const curveCanvas = document.getElementById("torque-curve-canvas") as HTMLCanvasElement | null;
	if (!curveCanvas) return;

	const dpr = window.devicePixelRatio || 1;
	const rect = curveCanvas.getBoundingClientRect();
	curveCanvas.width = rect.width * dpr;
	curveCanvas.height = rect.height * dpr;

	const ctx = curveCanvas.getContext("2d");
	if (!ctx) return;
	ctx.scale(dpr, dpr);

	const w = rect.width;
	const h = rect.height;
	const pad = { top: 6, right: 8, bottom: 16, left: 28 };
	const plotW = w - pad.left - pad.right;
	const plotH = h - pad.top - pad.bottom;

	ctx.fillStyle = "rgba(10,8,18,0.9)";
	ctx.fillRect(0, 0, w, h);

	const curve = activeConfig.engine.torqueCurve;
	if (curve.length < 2) return;

	const minRPM = curve[0][0];
	const maxRPM = curve[curve.length - 1][0];
	const maxMult = Math.max(...curve.map((c) => c[1]));

	ctx.strokeStyle = "rgba(139,92,246,0.1)";
	ctx.lineWidth = 0.5;
	for (let i = 0; i <= 4; i++) {
		const y = pad.top + (plotH * i) / 4;
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(w - pad.right, y);
		ctx.stroke();
	}

	ctx.strokeStyle = "rgba(139,92,246,0.8)";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	for (let i = 0; i < curve.length; i++) {
		const x = pad.left + ((curve[i][0] - minRPM) / (maxRPM - minRPM)) * plotW;
		const y = pad.top + plotH - (curve[i][1] / maxMult) * plotH;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();

	ctx.lineTo(pad.left + plotW, pad.top + plotH);
	ctx.lineTo(pad.left, pad.top + plotH);
	ctx.closePath();
	ctx.fillStyle = "rgba(139,92,246,0.08)";
	ctx.fill();

	ctx.fillStyle = "rgba(139,92,246,0.5)";
	ctx.font = "8px JetBrains Mono, monospace";
	ctx.textAlign = "center";
	const rpmStep = Math.round((maxRPM - minRPM) / 3 / 500) * 500 || 1000;
	for (let rpm = Math.ceil(minRPM / rpmStep) * rpmStep; rpm <= maxRPM; rpm += rpmStep) {
		const x = pad.left + ((rpm - minRPM) / (maxRPM - minRPM)) * plotW;
		ctx.fillText(String(rpm), x, h - 2);
	}
}

function buildSidebar(): void {
	sidebar!.innerHTML = "";

	for (const section of sections) {
		const sectionEl = document.createElement("div");
		sectionEl.className = "garage-section";

		const header = document.createElement("div");
		header.className = "section-header";
		header.innerHTML = `<span class="section-title">${section.title}</span><span class="section-chevron">&#9660;</span>`;

		const body = document.createElement("div");
		body.className = "section-body";

		header.addEventListener("click", () => {
			body.classList.toggle("collapsed");
			header.querySelector(".section-chevron")?.classList.toggle("collapsed");
		});

		for (const field of section.fields) {
			const row = document.createElement("div");
			row.className = "field-row";

			const label = document.createElement("label");
			label.className = "field-label";
			label.textContent = field.label;
			label.setAttribute("for", `field-${field.key}`);

			const input = document.createElement("input");
			input.type = "number";
			input.id = `field-${field.key}`;
			input.className = "field-input";
			if (field.min !== undefined) input.min = String(field.min);
			if (field.max !== undefined) input.max = String(field.max);
			if (field.step !== undefined) input.step = String(field.step);
			input.value = String(getNestedValue(currentTunable, field.path));

			input.addEventListener("change", () => {
				const val = Number.parseFloat(input.value);
				if (Number.isNaN(val)) return;
				setNestedValue(currentTunable as unknown as Record<string, unknown>, field.path, val);
				saveCustomConfig(currentTunable);
			});

			row.appendChild(label);
			row.appendChild(input);
			body.appendChild(row);
		}

		if (section.id === "engine") {
			const curveCanvas = document.createElement("canvas");
			curveCanvas.id = "torque-curve-canvas";
			body.appendChild(curveCanvas);
		}

		const resetBtn = document.createElement("button");
		resetBtn.className = "reset-btn";
		resetBtn.textContent = "Reset to Default";
		resetBtn.addEventListener("click", () => {
			const defaults = extractTunable(baseConfig);
			for (const field of section.fields) {
				const defaultVal = getNestedValue(defaults, field.path);
				setNestedValue(
					currentTunable as unknown as Record<string, unknown>,
					field.path,
					defaultVal,
				);
				const inputEl = document.getElementById(`field-${field.key}`) as HTMLInputElement | null;
				if (inputEl) inputEl.value = String(defaultVal);
			}
			saveCustomConfig(currentTunable);
			if (section.id === "engine") drawTorqueCurve();
		});
		body.appendChild(resetBtn);

		sectionEl.appendChild(header);
		sectionEl.appendChild(body);
		sidebar!.appendChild(sectionEl);
	}

	requestAnimationFrame(drawTorqueCurve);
}

buildSidebar();

window.addEventListener("beforeunload", () => {
	saveCustomConfig(currentTunable);
});
