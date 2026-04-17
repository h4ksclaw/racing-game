/**
 * Physics debug page — real-time vehicle physics visualization.
 * Runs VehicleController headlessly, displays gauges and graphs.
 */

import type { CarConfig } from "./vehicle/configs.ts";
import { RACE_CAR, SEDAN_CAR, SPORTS_CAR } from "./vehicle/configs.ts";
import type { VehicleInput } from "./vehicle/types.ts";
import { DEFAULT_INPUT } from "./vehicle/types.ts";
import { VehicleController } from "./vehicle/VehicleController.ts";

// ── Helpers ────────────────────────────────────────────────────────────

/** Get a DOM element or throw a clear error if missing. */
function $(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`[physics-debug] Missing element: #${id}`);
	return el;
}

/** Get canvas 2D context or throw. */
function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("[physics-debug] Cannot get 2d context");
	return ctx;
}

// ── State ──────────────────────────────────────────────────────────────

let running = false;
let currentConfig: CarConfig = RACE_CAR;
let controller: VehicleController;
let input: VehicleInput = { ...DEFAULT_INPUT };
let lastTime = 0;

const flatTerrain = {
	getHeight: () => 0,
	getNormal: () => ({ x: 0, y: 1, z: 0 }),
};

const MAX_HISTORY = 600;
const speedHistory: number[] = [];
const rpmHistory: number[] = [];
const timeHistory: number[] = [];
let simTime = 0;

// ── DOM refs ───────────────────────────────────────────────────────────

const btnStart = $("btn-start") as HTMLButtonElement;
const btnReset = $("btn-reset") as HTMLButtonElement;
const btnThrottle = $("btn-throttle") as HTMLButtonElement;
const btnBrake = $("btn-brake") as HTMLButtonElement;
const btnHandbrake = $("btn-handbrake") as HTMLButtonElement;
const btnLeft = $("btn-left") as HTMLButtonElement;
const btnRight = $("btn-right") as HTMLButtonElement;
const sliderThrottle = $("slider-throttle") as HTMLInputElement;
const sliderBrake = $("slider-brake") as HTMLInputElement;

const speedVal = $("speed-val");
const speedBar = $("speed-bar");
const rpmVal = $("rpm-val");
const rpmBar = $("rpm-bar");
const gearVal = $("gear-val");
const torqueVal = $("torque-val");
const engineForceVal = $("engine-force-val");
const brakeForceVal = $("brake-force-val");
const dragForceVal = $("drag-force-val");
const totalForceVal = $("total-force-val");
const engineBrakeVal = $("engine-brake-val");
const steerVal = $("steer-val");

const indThrottle = $("ind-throttle");
const indBrake = $("ind-brake");
const indHandbrake = $("ind-handbrake");
const indGround = $("ind-ground");
const indRevlim = $("ind-revlim");
const indShift = $("ind-shift");

const speedCanvas = $("speed-graph") as HTMLCanvasElement;
const rpmCanvas = $("rpm-graph") as HTMLCanvasElement;
const torqueCanvas = $("torque-curve") as HTMLCanvasElement;

// ── Init ───────────────────────────────────────────────────────────────

function initController() {
	controller = new VehicleController(currentConfig);
	controller.setTerrain(flatTerrain);
	controller.reset(0, 2, 0);
	speedHistory.length = 0;
	rpmHistory.length = 0;
	timeHistory.length = 0;
	simTime = 0;
}

initController();
drawTorqueCurve();

// ── Controls ───────────────────────────────────────────────────────────

btnStart.addEventListener("click", () => {
	running = !running;
	btnStart.textContent = running ? "⏸ Pause" : "▶ Start";
	btnStart.classList.toggle("active", running);
	if (running) {
		lastTime = performance.now();
		requestAnimationFrame(loop);
	}
});

btnReset.addEventListener("click", () => {
	running = false;
	btnStart.textContent = "▶ Start";
	btnStart.classList.remove("active");
	input = { ...DEFAULT_INPUT };
	updateButtonStates();
	initController();
	updateDisplays();
});

function toggleButton(btn: HTMLButtonElement, key: keyof VehicleInput) {
	btn.addEventListener("mousedown", () => {
		input[key] = true;
		updateButtonStates();
	});
	btn.addEventListener("mouseup", () => {
		input[key] = false;
		updateButtonStates();
	});
	btn.addEventListener("mouseleave", () => {
		input[key] = false;
		updateButtonStates();
	});
	btn.addEventListener("touchstart", (e) => {
		e.preventDefault();
		input[key] = true;
		updateButtonStates();
	});
	btn.addEventListener("touchend", () => {
		input[key] = false;
		updateButtonStates();
	});
}

toggleButton(btnThrottle, "forward");
toggleButton(btnBrake, "backward");
toggleButton(btnHandbrake, "handbrake");
toggleButton(btnLeft, "left");
toggleButton(btnRight, "right");

const valThrottle = $("val-throttle");
const valBrake = $("val-brake");
sliderThrottle.addEventListener("input", () => {
	valThrottle.textContent = parseFloat(sliderThrottle.value).toFixed(1);
});
sliderBrake.addEventListener("input", () => {
	valBrake.textContent = parseFloat(sliderBrake.value).toFixed(1);
});

for (const el of document.querySelectorAll('input[name="car"]')) {
	el.addEventListener("change", () => {
		currentConfig =
			(el as HTMLInputElement).value === "sedan"
				? SEDAN_CAR
				: (el as HTMLInputElement).value === "sports"
					? SPORTS_CAR
					: RACE_CAR;
		running = false;
		btnStart.textContent = "▶ Start";
		btnStart.classList.remove("active");
		initController();
		updateDisplays();
		drawTorqueCurve();
	});
}

// Keyboard
const keyState = new Set<string>();
document.addEventListener("keydown", (e) => {
	keyState.add(e.key);
	syncKeys();
});
document.addEventListener("keyup", (e) => {
	keyState.delete(e.key);
	syncKeys();
});

function syncKeys() {
	input.forward = keyState.has("w") || keyState.has("ArrowUp");
	input.backward = keyState.has("s") || keyState.has("ArrowDown");
	input.left = keyState.has("a") || keyState.has("ArrowLeft");
	input.right = keyState.has("d") || keyState.has("ArrowRight");
	input.brake = keyState.has(" ");
	input.handbrake = keyState.has("Shift");
	updateButtonStates();
}

function updateButtonStates() {
	btnThrottle.classList.toggle("active", input.forward);
	btnBrake.classList.toggle("active", input.backward);
	btnHandbrake.classList.toggle("active", input.handbrake);
	btnLeft.classList.toggle("active", input.left);
	btnRight.classList.toggle("active", input.right);
}

// ── Game Loop ──────────────────────────────────────────────────────────

function loop(now: number) {
	if (!running) return;
	const dt = Math.min((now - lastTime) / 1000, 1 / 30);
	lastTime = now;
	controller.update(input, dt);
	simTime += dt;

	const speedKmh = Math.abs(controller.state.speed) * 3.6;
	speedHistory.push(speedKmh);
	rpmHistory.push(controller.state.rpm);
	timeHistory.push(simTime);
	if (speedHistory.length > MAX_HISTORY) {
		speedHistory.shift();
		rpmHistory.shift();
		timeHistory.shift();
	}

	updateDisplays();
	drawGraphs();
	requestAnimationFrame(loop);
}

// ── Display Updates ────────────────────────────────────────────────────

// VehicleController.car is private but we need it for debug readout.
// Using a type-safe accessor pattern instead of `as any`.
interface CarModelReadonly {
	engine: {
		getTorqueMultiplier: () => number;
		getWheelForce: (ratio: number, radius: number, limit: number) => number;
		getEngineBraking: (speed: number, mass: number) => number;
		revLimited: boolean;
	};
	gearbox: {
		effectiveRatio: number;
		isShifting: boolean;
	};
	tires: { config: { maxTraction: number } };
	brakes: { getForce: (mass: number) => number };
	drag: { getForce: (speed: number) => number };
}

function getCarModel(vc: VehicleController): CarModelReadonly {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (vc as unknown as Record<string, unknown>).car as CarModelReadonly;
}

function updateDisplays() {
	const state = controller.state;
	const car = getCarModel(controller);
	const config = controller.config;
	const speedKmh = Math.abs(state.speed) * 3.6;

	speedVal.textContent = speedKmh.toFixed(0);
	speedBar.style.width = `${Math.min(100, (speedKmh / 300) * 100)}%`;

	rpmVal.textContent = state.rpm.toFixed(0);
	const rpmPct = ((state.rpm - config.engine.idleRPM) / (config.engine.maxRPM - config.engine.idleRPM)) * 100;
	rpmBar.style.width = `${Math.min(100, Math.max(0, rpmPct))}%`;
	rpmBar.classList.toggle("redline", rpmPct > config.engine.redlinePct * 100);

	gearVal.textContent = String(state.gear);

	const gearRatio = car.gearbox.effectiveRatio;
	const torqueMult = car.engine.getTorqueMultiplier();
	const torque = config.engine.torqueNm * torqueMult;
	const wheelRadius = config.chassis.wheelRadius;
	const tractionLimit = car.tires.config.maxTraction;
	let engineForce = car.engine.getWheelForce(gearRatio, wheelRadius, tractionLimit);
	if (car.gearbox.isShifting) engineForce *= 0.3;

	const mass = config.chassis.mass;
	const brakeForce = Math.abs(car.brakes.getForce(mass));
	const dragForce = car.drag.getForce(Math.abs(state.speed));
	const engineBrakeForce = car.engine.getEngineBraking(state.speed, mass);
	const totalLong = engineForce - brakeForce - dragForce - (engineBrakeForce > 0 ? engineBrakeForce : 0);

	torqueVal.textContent = `${torque.toFixed(1)} Nm`;
	engineForceVal.textContent = `${engineForce.toFixed(0)} N`;
	brakeForceVal.textContent = `${brakeForce.toFixed(0)} N`;
	dragForceVal.textContent = `${dragForce.toFixed(1)} N`;
	totalForceVal.textContent = `${totalLong.toFixed(0)} N`;
	engineBrakeVal.textContent = `${engineBrakeForce.toFixed(0)} N`;

	steerVal.textContent = `${((state.steeringAngle * 180) / Math.PI).toFixed(1)}°`;
	setInd(indThrottle, input.forward);
	setInd(indBrake, input.backward);
	setInd(indHandbrake, input.handbrake);
	setInd(indGround, state.onGround);
	setInd(indRevlim, car.engine.revLimited);
	setInd(indShift, car.gearbox.isShifting);
}

function setInd(el: HTMLElement, on: boolean) {
	el.classList.toggle("on", on);
}

// ── Graph Drawing ──────────────────────────────────────────────────────

function drawGraphs() {
	drawTimeGraph(speedCanvas, speedHistory, "#00d4ff", 300, "km/h");
	drawTimeGraph(rpmCanvas, rpmHistory, "#e94560", currentConfig.engine.maxRPM, "rpm");
}

function drawTimeGraph(canvas: HTMLCanvasElement, data: number[], color: string, maxVal: number, unit: string) {
	const ctx = getCtx(canvas);
	const dpr = window.devicePixelRatio || 1;
	if (canvas.width !== canvas.clientWidth * dpr) {
		canvas.width = canvas.clientWidth * dpr;
		canvas.height = canvas.clientHeight * dpr;
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const cw = canvas.clientWidth;
	const ch = canvas.clientHeight;
	ctx.clearRect(0, 0, cw, ch);
	if (data.length < 2) return;

	const autoMax = Math.max(maxVal * 0.1, ...data) * 1.1;

	ctx.strokeStyle = "#1a2a4a";
	ctx.lineWidth = 0.5;
	for (let i = 0; i <= 4; i++) {
		const y = (i / 4) * ch;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(cw, y);
		ctx.stroke();
		ctx.fillStyle = "#555";
		ctx.font = "10px monospace";
		ctx.fillText((autoMax * (1 - i / 4)).toFixed(0), 2, y - 2);
	}

	ctx.beginPath();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	for (let i = 0; i < data.length; i++) {
		const x = (i / (MAX_HISTORY - 1)) * cw;
		const y = ch - (data[i] / autoMax) * ch;
		i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	}
	ctx.stroke();

	ctx.fillStyle = color;
	ctx.font = "bold 12px monospace";
	ctx.fillText(`${data[data.length - 1].toFixed(0)} ${unit}`, cw - 80, 14);
}

function drawTorqueCurve() {
	const ctx = getCtx(torqueCanvas);
	const dpr = window.devicePixelRatio || 1;
	torqueCanvas.width = torqueCanvas.clientWidth * dpr;
	torqueCanvas.height = torqueCanvas.clientHeight * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const cw = torqueCanvas.clientWidth;
	const ch = torqueCanvas.clientHeight;
	ctx.clearRect(0, 0, cw, ch);

	const spec = currentConfig.engine;
	const curve = spec.torqueCurve;
	if (!curve.length) return;

	const minRPM = curve[0][0];
	const maxRPM = curve[curve.length - 1][0];
	const pad = 40;
	const graphW = cw - pad * 2;
	const graphH = ch - pad;

	// Grid
	ctx.strokeStyle = "#1a2a4a";
	ctx.lineWidth = 0.5;
	for (let i = 0; i <= 4; i++) {
		const y = pad + (i / 4) * graphH;
		ctx.beginPath();
		ctx.moveTo(pad, y);
		ctx.lineTo(cw - pad, y);
		ctx.stroke();
		const val = spec.torqueNm * (1 - i / 4);
		ctx.fillStyle = "#555";
		ctx.font = "10px monospace";
		ctx.fillText(`${val.toFixed(0)} Nm`, 2, y + 3);
	}
	// RPM labels
	for (let i = 0; i <= 4; i++) {
		const rpm = minRPM + (i / 4) * (maxRPM - minRPM);
		const x = pad + (i / 4) * graphW;
		ctx.fillStyle = "#555";
		ctx.font = "10px monospace";
		ctx.fillText(`${Math.round(rpm)}`, x - 10, ch - 5);
	}

	// Redline
	const redlineRPM = spec.maxRPM;
	if (redlineRPM >= minRPM && redlineRPM <= maxRPM) {
		const rx = pad + ((redlineRPM - minRPM) / (maxRPM - minRPM)) * graphW;
		ctx.strokeStyle = "#e94560";
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(rx, pad);
		ctx.lineTo(rx, pad + graphH);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = "#e94560";
		ctx.font = "10px monospace";
		ctx.fillText("REDLINE", rx + 4, pad + 12);
	}

	// Torque curve line
	ctx.beginPath();
	ctx.strokeStyle = "#00d4ff";
	ctx.lineWidth = 2;
	for (let rpm = minRPM; rpm <= maxRPM; rpm += 50) {
		let mult = curve[curve.length - 1][1];
		for (let i = 0; i < curve.length - 1; i++) {
			if (rpm >= curve[i][0] && rpm <= curve[i + 1][0]) {
				const t = (rpm - curve[i][0]) / (curve[i + 1][0] - curve[i][0] || 1);
				mult = curve[i][1] + (curve[i + 1][1] - curve[i][1]) * t;
				break;
			}
		}
		const x = pad + ((rpm - minRPM) / (maxRPM - minRPM)) * graphW;
		const y = pad + graphH - mult * graphH;
		rpm === minRPM ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	}
	ctx.stroke();

	// Fill under curve
	const lastRPM = maxRPM;
	ctx.lineTo(pad + ((lastRPM - minRPM) / (maxRPM - minRPM)) * graphW, pad + graphH);
	ctx.lineTo(pad, pad + graphH);
	ctx.closePath();
	ctx.fillStyle = "rgba(0, 212, 255, 0.08)";
	ctx.fill();
}
