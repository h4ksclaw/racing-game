/**
 * SkidAudio — procedural tire skid/screech sound.
 *
 * Generates a loopable tire skid sound using filtered white noise.
 * The noise is bandpass-filtered to simulate the characteristic
 * "sanding" sound of rubber sliding on asphalt.
 *
 * Usage:
 *   const skid = new SkidAudio(audioBus);
 *   skid.play(intensity);   // 0-1, fades in/out smoothly
 *   skid.stop();
 */

export class SkidAudio {
	private ctx: AudioContext | null = null;
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	private filter: BiquadFilterNode | null = null;
	private buffer: AudioBuffer | null = null;
	private playing = false;
	private targetGain = 0;
	private currentGain = 0;

	// Noise buffer is 2 seconds, looped seamlessly
	private static readonly BUFFER_DURATION = 2.0;

	constructor(private audioBus: { acquire(): AudioContext; release(): void }) {}

	/**
	 * Update skid intensity. Call every frame.
	 * @param intensity 0-1 (0 = no skid, 1 = full skid)
	 */
	update(intensity: number): void {
		this.targetGain = Math.max(0, Math.min(1, intensity));

		if (this.targetGain > 0.01 && !this.playing) {
			this.startPlayback();
		} else if (this.targetGain < 0.01 && this.playing) {
			this.stopPlayback();
		}

		// Smooth gain transition (ramp over ~50ms)
		if (this.gain && this.ctx) {
			this.currentGain += (this.targetGain - this.currentGain) * 0.1;
			this.gain.gain.setTargetAtTime(this.currentGain * 0.4, this.ctx.currentTime, 0.05);
			// Also adjust filter frequency based on intensity
			// Higher intensity = wider frequency band = more aggressive sound
			if (this.filter) {
				const freq = 800 + this.currentGain * 2000;
				const q = 1.5 - this.currentGain * 0.8; // lower Q = wider band
				this.filter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
				this.filter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.05);
			}
		}
	}

	private startPlayback(): void {
		try {
			this.ctx = this.audioBus.acquire();
			if (!this.buffer) {
				this.buffer = this.generateSkidBuffer(this.ctx);
			}

			// Create audio graph: source → filter → gain → destination
			this.source = this.ctx.createBufferSource();
			this.source.buffer = this.buffer;
			this.source.loop = true;

			this.filter = this.ctx.createBiquadFilter();
			this.filter.type = "bandpass";
			this.filter.frequency.value = 800;
			this.filter.Q.value = 1.5;

			// Second filter for more realistic texture (highpass removes rumble)
			const highpass = this.ctx.createBiquadFilter();
			highpass.type = "highpass";
			highpass.frequency.value = 400;

			this.gain = this.ctx.createGain();
			this.gain.gain.value = 0;

			this.source.connect(this.filter);
			this.filter.connect(highpass);
			highpass.connect(this.gain);
			this.gain.connect(this.ctx.destination);

			this.source.start();
			this.playing = true;
		} catch {
			// Audio context may be blocked by browser
			this.playing = false;
		}
	}

	private stopPlayback(): void {
		if (this.source) {
			try {
				this.source.stop();
			} catch {
				// Already stopped
			}
			this.source.disconnect();
			this.source = null;
		}
		if (this.gain) {
			this.gain.disconnect();
			this.gain = null;
		}
		if (this.filter) {
			this.filter.disconnect();
			this.filter = null;
		}
		if (this.ctx) {
			this.audioBus.release();
			this.ctx = null;
		}
		this.playing = false;
	}

	/**
	 * Generate a procedural tire skid sound buffer.
	 * Uses filtered white noise with amplitude modulation to simulate
	 * the irregular texture of rubber sliding on asphalt.
	 */
	private generateSkidBuffer(ctx: AudioContext): AudioBuffer {
		const duration = SkidAudio.BUFFER_DURATION;
		const sampleRate = ctx.sampleRate;
		const length = Math.floor(sampleRate * duration);
		const buffer = ctx.createBuffer(1, length, sampleRate);
		const data = buffer.getChannelData(0);

		// Generate noise with amplitude modulation for realistic texture
		let prev = 0;
		for (let i = 0; i < length; i++) {
			// Brown noise (random walk) — warmer, less harsh than white noise
			const white = Math.random() * 2 - 1;
			prev = (prev + 0.02 * white) / 1.02;

			// Add some white noise for high-frequency "grain"
			const grain = (Math.random() * 2 - 1) * 0.15;

			// Amplitude modulation: slow random variation simulates
			// irregular tire contact patches on asphalt
			const t = i / sampleRate;
			const mod = 0.7 + 0.3 * Math.sin(t * 7.3) * Math.sin(t * 3.7) * Math.cos(t * 11.1);

			// Crossfade at loop boundaries for seamless looping
			const fadeIn = Math.min(1, i / (sampleRate * 0.02)); // 20ms fade in
			const fadeOut = Math.min(1, (length - i) / (sampleRate * 0.02)); // 20ms fade out

			data[i] = (prev + grain) * mod * fadeIn * fadeOut;
		}

		return buffer;
	}

	dispose(): void {
		this.stopPlayback();
		this.buffer = null;
	}
}
