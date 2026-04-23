import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	applyOverrides,
	extractTunable,
	loadCustomConfig,
	saveCustomConfig,
	type TunableConfig,
} from "./ui/garage-store.ts";
import { SPORTS_CAR } from "./vehicle/configs.ts";

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
scene.background = new THREE.Color(0x11131c);

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
const hemi = new THREE.HemisphereLight(0x5c9eff, 0x0d1525, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(5, 8, 4);
scene.add(dir);

const ambient = new THREE.AmbientLight(0x1a2a4a, 0.4);
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
			{
				key: "idleRPM",
				path: "engine.idleRPM",
				label: "Idle RPM",
				min: 500,
				max: 1500,
				step: 50,
			},
			{
				key: "maxRPM",
				path: "engine.maxRPM",
				label: "Max RPM",
				min: 4000,
				max: 10000,
				step: 100,
			},
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
			{
				key: "aeroDrag",
				path: "drag.aeroDrag",
				label: "Aero Drag",
				step: 0.01,
			},
		],
	},
	{
		id: "chassis",
		title: "Chassis",
		fields: [
			{
				key: "mass",
				path: "chassis.mass",
				label: "Mass (kg)",
				min: 50,
				max: 3000,
				step: 10,
			},
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
			{
				key: "cgHeight",
				path: "chassis.cgHeight",
				label: "CG Height",
				step: 0.01,
			},
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

function updateSliderFill(slider: HTMLInputElement): void {
	const min = Number(slider.min) || 0;
	const max = Number(slider.max) || 100;
	const val = Number(slider.value);
	const pct = ((val - min) / (max - min)) * 100;
	slider.style.background = `linear-gradient(to right, rgba(92,158,255,0.4) 0%, rgba(92,158,255,0.4) ${pct}%, rgba(92,158,255,0.08) ${pct}%, rgba(92,158,255,0.08) 100%)`;
}

function makeValueEditable(
	span: HTMLSpanElement,
	slider: HTMLInputElement,
	path: string,
	step: number,
	min: number,
	max: number,
	onChange?: () => void,
): void {
	span.addEventListener("click", () => {
		const input = document.createElement("input");
		input.type = "number";
		input.className = "field-value-input";
		input.value = span.textContent || "0";
		input.step = String(step);
		input.min = String(min);
		input.max = String(max);
		span.replaceWith(input);
		input.focus();
		input.select();

		function commit(): void {
			const val = Number.parseFloat(input.value);
			if (!Number.isNaN(val)) {
				const clamped = Math.min(max, Math.max(min, val));
				slider.value = String(clamped);
				updateSliderFill(slider);
				setNestedValue(currentTunable as unknown as Record<string, unknown>, path, clamped);
				saveCustomConfig(currentTunable);
				onChange?.();
			}
			const newSpan = document.createElement("span");
			newSpan.className = "field-value";
			newSpan.textContent = slider.value;
			input.replaceWith(newSpan);
			makeValueEditable(newSpan, slider, path, step, min, max, onChange);
		}

		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") commit();
			if (e.key === "Escape") {
				const newSpan = document.createElement("span");
				newSpan.className = "field-value";
				newSpan.textContent = span.textContent;
				input.replaceWith(newSpan);
				makeValueEditable(newSpan, slider, path, step, min, max, onChange);
			}
		});
	});
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

	ctx.fillStyle = "rgba(17,19,28,0.9)";
	ctx.fillRect(0, 0, w, h);

	const curve = activeConfig.engine.torqueCurve;
	if (curve.length < 2) return;

	const minRPM = curve[0][0];
	const maxRPM = curve[curve.length - 1][0];
	const maxMult = Math.max(...curve.map((c) => c[1]));
	const idleRPM = activeConfig.engine.idleRPM;
	const redlineRPM = activeConfig.engine.maxRPM * activeConfig.engine.redlinePct;

	// Grid lines
	ctx.strokeStyle = "rgba(92,158,255,0.08)";
	ctx.lineWidth = 0.5;
	for (let i = 0; i <= 4; i++) {
		const y = pad.top + (plotH * i) / 4;
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(w - pad.right, y);
		ctx.stroke();
	}

	// Idle RPM line
	if (idleRPM > minRPM && idleRPM < maxRPM) {
		const ix = pad.left + ((idleRPM - minRPM) / (maxRPM - minRPM)) * plotW;
		ctx.strokeStyle = "rgba(255,255,255,0.15)";
		ctx.lineWidth = 0.5;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(ix, pad.top);
		ctx.lineTo(ix, pad.top + plotH);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Redline zone
	if (redlineRPM > minRPM && redlineRPM < maxRPM) {
		const rx = pad.left + ((redlineRPM - minRPM) / (maxRPM - minRPM)) * plotW;
		ctx.fillStyle = "rgba(239,68,68,0.08)";
		ctx.fillRect(rx, pad.top, w - pad.right - rx, plotH);
		ctx.strokeStyle = "rgba(239,68,68,0.5)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(rx, pad.top);
		ctx.lineTo(rx, pad.top + plotH);
		ctx.stroke();
	}

	// Gradient fill under curve
	ctx.beginPath();
	for (let i = 0; i < curve.length; i++) {
		const x = pad.left + ((curve[i][0] - minRPM) / (maxRPM - minRPM)) * plotW;
		const y = pad.top + plotH - (curve[i][1] / maxMult) * plotH;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.lineTo(pad.left + plotW, pad.top + plotH);
	ctx.lineTo(pad.left, pad.top + plotH);
	ctx.closePath();
	const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
	grad.addColorStop(0, "rgba(92,158,255,0.2)");
	grad.addColorStop(1, "rgba(92,158,255,0.02)");
	ctx.fillStyle = grad;
	ctx.fill();

	// Curve line with glow
	ctx.save();
	ctx.shadowColor = "rgba(92,158,255,0.6)";
	ctx.shadowBlur = 6;
	ctx.strokeStyle = "rgba(92,158,255,0.9)";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	for (let i = 0; i < curve.length; i++) {
		const x = pad.left + ((curve[i][0] - minRPM) / (maxRPM - minRPM)) * plotW;
		const y = pad.top + plotH - (curve[i][1] / maxMult) * plotH;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();
	ctx.restore();

	// RPM labels
	ctx.fillStyle = "rgba(92,158,255,0.5)";
	ctx.font = "8px JetBrains Mono, monospace";
	ctx.textAlign = "center";
	const rpmStep = Math.round((maxRPM - minRPM) / 3 / 500) * 500 || 1000;
	for (let rpm = Math.ceil(minRPM / rpmStep) * rpmStep; rpm <= maxRPM; rpm += rpmStep) {
		const x = pad.left + ((rpm - minRPM) / (maxRPM - minRPM)) * plotW;
		ctx.fillText(String(rpm), x, h - 2);
	}
}

function buildSliderField(field: FieldDef, sectionId?: string): HTMLDivElement {
	const row = document.createElement("div");
	row.className = "field-row";

	const currentVal = getNestedValue(currentTunable, field.path);
	const defaultVal = currentVal || 1;
	const min = field.min ?? Math.round(defaultVal * 0.3 * 1000) / 1000;
	const max = field.max ?? Math.round(defaultVal * 2.0 * 1000) / 1000;
	const step = field.step ?? 0.01;

	// Header: label + value
	const header = document.createElement("div");
	header.className = "field-header";

	const label = document.createElement("span");
	label.className = "field-label";
	label.textContent = field.label;

	const valueSpan = document.createElement("span");
	valueSpan.className = "field-value";
	valueSpan.textContent = formatVal(currentVal, step);

	header.appendChild(label);
	header.appendChild(valueSpan);

	// Slider
	const slider = document.createElement("input");
	slider.type = "range";
	slider.id = `field-${field.key}`;
	slider.className = "tune-slider";
	slider.min = String(min);
	slider.max = String(max);
	slider.step = String(step);
	slider.value = String(currentVal);
	updateSliderFill(slider);

	slider.addEventListener("input", () => {
		const val = Number(slider.value);
		valueSpan.textContent = formatVal(val, step);
		updateSliderFill(slider);
		setNestedValue(currentTunable as unknown as Record<string, unknown>, field.path, val);
		saveCustomConfig(currentTunable);
		if (sectionId === "engine") drawTorqueCurve();
	});

	// Min/max labels
	const rangeLabels = document.createElement("div");
	rangeLabels.className = "field-range-labels";
	const minLabel = document.createElement("span");
	minLabel.textContent = formatVal(min, step);
	const maxLabel = document.createElement("span");
	maxLabel.textContent = formatVal(max, step);
	rangeLabels.appendChild(minLabel);
	rangeLabels.appendChild(maxLabel);

	const rangeRow = document.createElement("div");
	rangeRow.className = "field-range-row";
	rangeRow.appendChild(slider);
	rangeRow.appendChild(rangeLabels);

	row.appendChild(header);
	row.appendChild(rangeRow);

	makeValueEditable(valueSpan, slider, field.path, step, min, max, () => {
		if (sectionId === "engine") drawTorqueCurve();
	});

	return row;
}

function formatVal(val: number, step: number): string {
	const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
	return val.toFixed(decimals);
}

function buildGearChart(sectionFields: FieldDef[]): HTMLDivElement {
	const gearFields = sectionFields.filter((f) => f.key.startsWith("gear"));
	if (gearFields.length === 0) {
		const div = document.createElement("div");
		return div;
	}

	const container = document.createElement("div");
	const chart = document.createElement("div");
	chart.className = "gear-chart";

	const maxRatio = Math.max(...gearFields.map((f) => getNestedValue(currentTunable, f.path)), 0.1);
	const bars: { bar: HTMLDivElement; field: FieldDef }[] = [];

	for (const field of gearFields) {
		const col = document.createElement("div");
		col.className = "gear-bar-col";

		const bar = document.createElement("div");
		bar.className = "gear-bar";
		const val = getNestedValue(currentTunable, field.path);
		bar.style.height = `${(val / maxRatio) * 100}%`;

		const label = document.createElement("div");
		label.className = "gear-bar-label";
		label.textContent = val.toFixed(2);

		col.appendChild(bar);
		col.appendChild(label);
		chart.appendChild(col);
		bars.push({ bar, field });
	}

	container.appendChild(chart);

	// Edit slider (shown when a bar is clicked)
	const editArea = document.createElement("div");
	editArea.className = "gear-edit-slider";
	editArea.style.display = "none";

	const editLabel = document.createElement("div");
	editLabel.className = "gear-edit-label";

	const editSlider = document.createElement("input");
	editSlider.type = "range";
	editSlider.className = "tune-slider";
	editSlider.min = "0.5";
	editSlider.max = String(Math.round(maxRatio * 1.5 * 100) / 100);
	editSlider.step = "0.01";

	const editLabels = document.createElement("div");
	editLabels.className = "field-range-labels";
	const editMin = document.createElement("span");
	editMin.textContent = "0.50";
	const editMax = document.createElement("span");
	editMax.textContent = editSlider.max;
	editLabels.appendChild(editMin);
	editLabels.appendChild(editMax);

	editArea.appendChild(editLabel);
	editArea.appendChild(editSlider);
	editArea.appendChild(editLabels);
	container.appendChild(editArea);

	let activeField: FieldDef | null = null;

	for (const { bar, field } of bars) {
		bar.addEventListener("click", () => {
			for (const b of bars) b.bar.classList.remove("selected");
			bar.classList.add("selected");
			activeField = field;
			const val = getNestedValue(currentTunable, field.path);
			editSlider.value = String(val);
			updateSliderFill(editSlider);
			editLabel.textContent = field.label;
			editArea.style.display = "block";
		});
	}

	editSlider.addEventListener("input", () => {
		if (!activeField) return;
		const val = Number(editSlider.value);
		setNestedValue(currentTunable as unknown as Record<string, unknown>, activeField.path, val);
		saveCustomConfig(currentTunable);
		updateSliderFill(editSlider);

		// Update the bar
		const entry = bars.find((b) => b.field.key === activeField?.key);
		if (entry) {
			const newMax = Math.max(
				...bars.map((b) => (b.field.key === activeField?.key ? val : getNestedValue(currentTunable, b.field.path))),
				0.1,
			);
			entry.bar.style.height = `${(val / newMax) * 100}%`;
			const next = entry.bar.nextElementSibling;
			if (next) next.textContent = val.toFixed(2);
			// Resize all bars relative to new max
			for (const b of bars) {
				const bv = getNestedValue(currentTunable, b.field.path);
				b.bar.style.height = `${(bv / newMax) * 100}%`;
			}
		}
	});

	return container;
}

function buildSidebar(): void {
	if (sidebar) sidebar.innerHTML = "";

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

		// Gearbox: use bar chart for gear ratios, slider for shift time
		if (section.id === "gearbox") {
			const gearChart = buildGearChart(section.fields);
			body.appendChild(gearChart);

			// Shift time as regular slider
			const shiftField = section.fields.find((f) => f.key === "shiftTime");
			if (shiftField) body.appendChild(buildSliderField(shiftField, "gearbox"));
		} else {
			for (const field of section.fields) {
				body.appendChild(buildSliderField(field, section.id));
			}
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
				setNestedValue(currentTunable as unknown as Record<string, unknown>, field.path, defaultVal);
				const sliderEl = document.getElementById(`field-${field.key}`) as HTMLInputElement | null;
				if (sliderEl) {
					sliderEl.value = String(defaultVal);
					updateSliderFill(sliderEl);
					// Update value span
					const row = sliderEl.closest(".field-row");
					if (row) {
						const valSpan = row.querySelector(".field-value") as HTMLSpanElement | null;
						if (valSpan) valSpan.textContent = formatVal(defaultVal, field.step ?? 0.01);
					}
				}
			}
			saveCustomConfig(currentTunable);
			if (section.id === "engine") drawTorqueCurve();
			// Rebuild gear chart if gearbox
			if (section.id === "gearbox") {
				const oldChart = body.querySelector(".gear-chart")?.parentElement;
				if (oldChart) {
					const newChart = buildGearChart(section.fields);
					oldChart.replaceWith(newChart);
				}
			}
		});
		body.appendChild(resetBtn);

		sectionEl.appendChild(header);
		sectionEl.appendChild(body);
		sidebar?.appendChild(sectionEl);
	}

	requestAnimationFrame(drawTorqueCurve);
}

buildSidebar();

window.addEventListener("beforeunload", () => {
	saveCustomConfig(currentTunable);
});
