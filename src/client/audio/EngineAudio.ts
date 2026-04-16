/**
 * EngineAudio — procedural engine sound synthesis with spatial audio.
 *
 * Features:
 *   - Additive harmonic synthesis (configurable per-engine)
 *   - 4 noise layers: exhaust, intake, mechanical, valvetrain
 *   - WaveShaper distortion
 *   - Exhaust system simulation (stock/sport/straight/race)
 *   - Misfire, backfire, knock, valve float effects
 *   - Turbo wastegate blow-off
 *   - Convolution reverb (room simulation)
 *   - HRTF spatial audio via PannerNode
 *   - Multi-car support (each instance = one car)
 *
 * Integration:
 *   const audio = new EngineAudio(SOUND_PROFILE);
 *   audio.start();
 *   // In animate():
 *   audio.update(vehicle.telemetry, vehicle.getPosition());
 *   AudioBus.getInstance().updateListener(camera.position, cameraForward);
 */

import type { EngineTelemetry } from "../vehicle/types.ts";
import { AudioBus } from "./AudioBus.ts";
import type { EngineSoundConfig, ExhaustType, HarmonicDef } from "./audio-types.ts";
import { EXHAUST_SYSTEMS } from "./audio-types.ts";

// ── Helpers ─────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * Math.max(0, Math.min(1, t));
}

function rpmNorm(rpm: number, idle: number, max: number): number {
	const range = max - idle;
	if (range <= 0) return 0;
	return Math.min(1, Math.max(0, (rpm - idle) / range));
}

function firingFreq(rpm: number, cylinders: number, stroke: number): number {
	return (rpm / 60) * (cylinders / stroke);
}

function createWaveshaperCurve(amount: number): Float32Array<ArrayBuffer> {
	const samples = 44100;
	const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
	const deg = Math.PI / 180;
	for (let i = 0; i < samples; i++) {
		const x = (i * 2) / samples - 1;
		curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
	}
	return curve;
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
	const size = ctx.sampleRate * 2;
	const buf = ctx.createBuffer(1, size, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < size; i++) {
		data[i] = Math.random() * 2 - 1;
	}
	return buf;
}

function createImpulseBuffer(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
	const rate = ctx.sampleRate;
	const length = Math.floor(rate * duration);
	const buf = ctx.createBuffer(2, length, rate);
	for (let ch = 0; ch < 2; ch++) {
		const data = buf.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
		}
	}
	return buf;
}

// ── EngineAudio class ────────────────────────────────────────────────────

export class EngineAudio {
	private config: EngineSoundConfig;
	private bus: AudioBus;
	private ctx: AudioContext;

	// Audio nodes
	private oscs: { osc: OscillatorNode; gain: GainNode; def: HarmonicDef }[] = [];
	private noiseLayers: {
		source: AudioBufferSourceNode;
		filter: BiquadFilterNode;
		gain: GainNode;
		config: { freq: number; q: number; level: number };
		key: string;
	}[] = [];
	private distortionNode: WaveShaperNode | null = null;
	private masterGain: GainNode | null = null;
	private dryGain: GainNode | null = null;
	private reverbGain: GainNode | null = null;
	private convolver: ConvolverNode | null = null;
	private analyser: AnalyserNode | null = null;
	private panner: PannerNode | null = null;

	// State tracking
	private active = false;
	private prevThrottle = 0;
	private currentThrottle = 0;

	private misfireTimer = 0;

	constructor(config: EngineSoundConfig) {
		this.config = config;
		this.bus = AudioBus.getInstance();
		this.ctx = this.bus.acquire();
	}

	/** Build the audio graph. Call once, then update() every frame. */
	start(): void {
		if (this.active) return;
		this.active = true;

		const ctx = this.ctx;

		// Spatial panner (HRTF for headphone realism)
		this.panner = ctx.createPanner();
		this.panner.panningModel = "HRTF";
		this.panner.distanceModel = "inverse";
		this.panner.refDistance = 5;
		this.panner.maxDistance = 500;
		this.panner.rolloffFactor = 1;
		this.panner.coneInnerAngle = 360;
		this.panner.coneOuterAngle = 360;

		// Master gain
		this.masterGain = ctx.createGain();
		this.masterGain.gain.value = 0;

		// Dry/wet split for reverb
		this.dryGain = ctx.createGain();
		this.dryGain.gain.value = 0.85;
		this.reverbGain = ctx.createGain();
		this.reverbGain.gain.value = 0.15;

		// Convolution reverb (room ambience)
		this.convolver = ctx.createConvolver();
		this.convolver.buffer = createImpulseBuffer(ctx, 0.3, 2);

		// Distortion
		this.distortionNode = ctx.createWaveShaper();
		this.distortionNode.curve = createWaveshaperCurve(this.config.distortion);
		this.distortionNode.oversample = "4x";

		// Analyser (for visualization)
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 2048;
		this.analyser.smoothingTimeConstant = 0.8;

		// Routing: distortion -> dry + reverb -> master -> panner -> analyser -> out
		this.distortionNode.connect(this.dryGain);
		this.distortionNode.connect(this.convolver);
		this.convolver.connect(this.reverbGain);
		this.dryGain.connect(this.masterGain);
		this.reverbGain.connect(this.masterGain);
		this.masterGain.connect(this.panner);
		this.panner.connect(this.analyser);
		this.analyser.connect(ctx.destination);

		// Harmonic oscillators
		for (const h of this.config.harmonics) {
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.value = 20;

			const gain = ctx.createGain();
			gain.gain.value = 0;

			osc.connect(gain);
			gain.connect(this.distortionNode);
			osc.start();

			this.oscs.push({ osc, gain, def: h });
		}

		// Noise layers (4 layers from shared noise buffer)
		const noiseBuf = createNoiseBuffer(ctx);
		const layerDefs: { key: string; config: { freq: number; q: number; level: number } }[] = [
			{ key: "exhaust", config: this.config.noise.exhaust },
			{ key: "intake", config: this.config.noise.intake },
			{ key: "mechanical", config: this.config.noise.mechanical },
			{ key: "valvetrain", config: this.config.noise.valvetrain },
		];

		for (const ld of layerDefs) {
			const source = ctx.createBufferSource();
			source.buffer = noiseBuf;
			source.loop = true;

			const filter = ctx.createBiquadFilter();
			filter.type = "bandpass";
			filter.frequency.value = ld.config.freq;
			filter.Q.value = ld.config.q;

			const gain = ctx.createGain();
			gain.gain.value = 0;

			source.connect(filter);
			filter.connect(gain);
			gain.connect(this.distortionNode);
			source.start();

			this.noiseLayers.push({ source, filter, gain, config: ld.config, key: ld.key });
		}
	}

	/**
	 * Update engine sound from telemetry. Call every frame.
	 *
	 * @param telemetry - Engine telemetry (RPM, throttle, load, boost, etc.)
	 * @param pos - World position {x, y, z} for spatial audio
	 */
	update(telemetry: EngineTelemetry, pos?: { x: number; y: number; z: number }): void {
		if (!this.active) return;

		const ctx = this.ctx;
		const now = ctx.currentTime;
		const ramp = 0.02;

		const rpm = telemetry.rpm;
		const thr = Math.max(0, Math.min(1, telemetry.throttle));
		this.currentThrottle = thr;
		const ld = telemetry.load;
		const rn = rpmNorm(rpm, this.config.idleRPM, this.config.maxRPM);
		const f0 = firingFreq(rpm, this.config.cylinders, this.config.stroke);

		// Exhaust system modifiers
		const exType: ExhaustType = "stock";
		const ex = EXHAUST_SYSTEMS[exType];
		const exVol = ex.volumeMultiplier;
		const hfDamp = ex.highFreqDamp;

		// Load-dependent spectral shaping
		const loadBassBoost = 1 + ld * 0.25;
		const loadTrebleShift = 1 + ld * 0.15;
		const loadWarmth = 0.7 + ld * 0.3;
		const coastingThin = ld < 0.2 ? 1 + (0.2 - ld) * 0.8 : 1;

		// ── Harmonic oscillators ──
		for (const { osc, gain, def } of this.oscs) {
			osc.frequency.setTargetAtTime(Number(Math.max(20, f0 * def.mult)) || 20, now, ramp);

			const rpmFactor = lerp(def.rpmScale[0], def.rpmScale[1], rn);
			const thrFactor = lerp(def.thrScale[0], def.thrScale[1], thr);
			let amp = def.baseAmp * rpmFactor * thrFactor;

			if (def.mult <= 1) {
				amp *= loadBassBoost;
			} else if (def.mult <= 3) {
				amp *= loadWarmth;
			} else {
				amp *= loadTrebleShift;
			}
			amp /= coastingThin;

			if (def.mult > 2) {
				amp *= 1 - hfDamp * (def.mult / 12);
			}

			gain.gain.setTargetAtTime(Number(Math.max(0, amp * exVol)) || 0, now, ramp);
		}

		// ── Noise layers ──
		for (const nl of this.noiseLayers) {
			let level = nl.config.level * exVol;

			switch (nl.key) {
				case "exhaust":
					level *= lerp(0.3, 1, thr) * lerp(0.5, 1, rn);
					{
						const loadFreqShift = 1 - ld * 0.3;
						const loadWidthShift = 1 + ld * 0.5;
						nl.filter.frequency.setTargetAtTime(
							Number(nl.config.freq * lerp(0.8, 2.5, rn) * loadFreqShift) || 100,
							now,
							0.05,
						);
						nl.filter.Q.setTargetAtTime(
							Number(nl.config.q * (1 + ex.resonance * 2) * loadWidthShift) || 1,
							now,
							0.05,
						);
					}
					break;

				case "intake":
					level *= lerp(0.2, 0.8, rn) * lerp(0.1, 1, thr);
					if (this.config.turbo && telemetry.boost > 0) {
						level *= 1 + telemetry.boost / 5;
						nl.filter.Q.setTargetAtTime(
							Number(nl.config.q * (1 + telemetry.boost / 3)) || 1,
							now,
							0.05,
						);
					}
					break;

				case "mechanical":
					level *= lerp(0.3, 1, rn);
					break;

				case "valvetrain":
					level *= lerp(0.2, 1, rn);
					break;
			}

			nl.gain.gain.setTargetAtTime(Number(Math.max(0, level)) || 0, now, ramp);
		}

		// ── Master volume ──
		let vol = this.config.volume * exVol * lerp(0.4, 1, rn) * lerp(0.5, 1, thr);

		if (telemetry.revLimited && rpm >= this.config.revLimiterRPM) {
			vol *= 0.3;
		}

		if (this.masterGain) {
			this.masterGain.gain.setTargetAtTime(Number(Math.max(0, vol)) || 0, now, 0.05);
		}

		// ── Spatial position ──
		if (this.panner && pos) {
			this.panner.positionX.setTargetAtTime(pos.x, now, ramp);
			this.panner.positionY.setTargetAtTime(pos.y, now, ramp);
			this.panner.positionZ.setTargetAtTime(pos.z, now, ramp);
		}

		// ── Special effects ──
		this.processMisfire(rpm);
		this.processBackfire(rpm);
		this.processWastegate(telemetry.boost);

		this.prevThrottle = thr;
	}

	private processMisfire(rpm: number): void {
		const ctx = this.ctx;
		const now = ctx.currentTime;
		const distNode = this.distortionNode;
		if (!distNode) return;

		const prob = 0.002 * (1 - rpmNorm(rpm, this.config.idleRPM, this.config.maxRPM));
		this.misfireTimer -= 1;
		if (this.misfireTimer <= 0 && Math.random() < prob) {
			this.misfireTimer = 5 + Math.random() * 15;

			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "square";
			osc.frequency.value = 60 + Math.random() * 40;
			gain.gain.setValueAtTime(0.15, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
			osc.connect(gain);
			gain.connect(distNode);
			osc.start(now);
			osc.stop(now + 0.1);
		}
	}

	private processBackfire(rpm: number): void {
		if (this.currentThrottle > 0.1) return;
		if (rpm < this.config.revLimiterRPM * 0.7) return;
		const ctx = this.ctx;
		const now = ctx.currentTime;
		const distNode = this.distortionNode;
		if (!distNode) return;

		const prob = this.config.turbo ? 0.02 : 0.005;
		if (Math.random() >= prob) return;

		const size = Math.floor(ctx.sampleRate * 0.15);
		const buf = ctx.createBuffer(1, size, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < size; i++) {
			data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.05));
		}

		const source = ctx.createBufferSource();
		source.buffer = buf;
		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 3000;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.3, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

		source.connect(filter);
		filter.connect(gain);
		gain.connect(distNode);
		source.start(now);
	}

	private processWastegate(boost: number): void {
		if (!this.config.turbo || boost < 0.2) return;
		if (this.currentThrottle >= this.prevThrottle - 0.2) return;
		const ctx = this.ctx;
		const now = ctx.currentTime;
		const masterGain = this.masterGain;
		if (!masterGain) return;

		const duration = 0.2 + boost * 0.3;
		const size = Math.floor(ctx.sampleRate * duration);
		const buf = ctx.createBuffer(1, size, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < size; i++) {
			const env = Math.exp(-i / (size * 0.15));
			data[i] = Math.sin(2 * Math.PI * (1200 + boost * 500) * (i / ctx.sampleRate)) * env;
			data[i] += (Math.random() * 2 - 1) * env * 0.3;
		}

		const source = ctx.createBufferSource();
		source.buffer = buf;
		const gain = ctx.createGain();
		gain.gain.value = 0.12;
		source.connect(gain);
		gain.connect(masterGain);
		source.start(now);
	}

	/** Get the AnalyserNode for visualization (waveform/spectrum). */
	getAnalyser(): AnalyserNode | null {
		return this.analyser;
	}

	/** Set reverb amount (0 = dry, 1 = fully wet). */
	setReverb(amount: number): void {
		if (this.reverbGain && this.dryGain) {
			this.reverbGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.1);
			this.dryGain.gain.setTargetAtTime(1 - amount, this.ctx.currentTime, 0.1);
		}
	}

	/** Tear down all audio nodes. */
	stop(): void {
		if (!this.active) return;
		this.active = false;

		for (const { osc } of this.oscs) {
			try {
				osc.stop();
			} catch {
				// already stopped
			}
		}
		for (const { source } of this.noiseLayers) {
			try {
				source.stop();
			} catch {
				// already stopped
			}
		}

		this.oscs = [];
		this.noiseLayers = [];
		this.distortionNode = null;
		this.masterGain = null;
		this.panner = null;

		this.bus.release();
	}
}
