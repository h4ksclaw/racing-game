/**
 * Audio manager for engine sounds and SFX.
 * Uses Web Audio API for real-time audio.
 */

export class AudioManager {
	private ctx: AudioContext | null = null;
	private engineOscillator: OscillatorNode | null = null;
	private engineGain: GainNode | null = null;

	/** Initialize audio context (must be called from user gesture) */
	init(): void {
		this.ctx = new AudioContext();

		// Setup engine oscillator as placeholder
		this.engineOscillator = this.ctx.createOscillator();
		this.engineOscillator.type = "sawtooth";
		this.engineOscillator.frequency.value = 80;

		this.engineGain = this.ctx.createGain();
		this.engineGain.gain.value = 0;

		this.engineOscillator.connect(this.engineGain);
		this.engineGain.connect(this.ctx.destination);
		this.engineOscillator.start();
	}

	/** Update engine sound based on speed */
	updateEngine(_speed: number, _rpm: number): void {
		if (!this.engineOscillator || !this.engineGain) return;
		// TODO: Map speed to frequency and gain for realistic engine sound
		// This oscillator is a placeholder — replace with actual engine audio samples
	}

	/** Play a one-shot sound effect */
	playSFX(_name: string): void {
		// TODO: Load and play sound effects (tire screech, collision, etc.)
	}

	resume(): void {
		this.ctx?.resume();
	}

	dispose(): void {
		this.engineOscillator?.stop();
		this.engineOscillator?.disconnect();
		this.engineGain?.disconnect();
		this.ctx?.close();
	}
}
