/**
 * AudioBus — shared AudioContext singleton.
 *
 * All engine audio instances share one AudioContext.
 * The listener position (camera) is updated once per frame.
 */

export class AudioBus {
	private static instance: AudioBus | null = null;
	private ctx: AudioContext | null = null;
	private refCount = 0;

	private constructor() {}

	static getInstance(): AudioBus {
		if (!AudioBus.instance) {
			AudioBus.instance = new AudioBus();
		}
		return AudioBus.instance;
	}

	getContext(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
		}
		return this.ctx;
	}

	acquire(): AudioContext {
		this.refCount++;
		const ctx = this.getContext();
		if (ctx.state === "suspended") {
			ctx.resume();
		}
		return ctx;
	}

	release(): void {
		this.refCount--;
		if (this.refCount <= 0 && this.ctx) {
			this.ctx.close();
			this.ctx = null;
		}
	}

	updateListener(pos: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
		const ctx = this.ctx;
		if (!ctx) return;

		const now = ctx.currentTime;
		const ramp = 0.05;

		ctx.listener.positionX.setTargetAtTime(pos.x, now, ramp);
		ctx.listener.positionY.setTargetAtTime(pos.y, now, ramp);
		ctx.listener.positionZ.setTargetAtTime(pos.z, now, ramp);

		ctx.listener.forwardX.setTargetAtTime(forward.x, now, ramp);
		ctx.listener.forwardY.setTargetAtTime(forward.y, now, ramp);
		ctx.listener.forwardZ.setTargetAtTime(forward.z, now, ramp);

		ctx.listener.upX.setTargetAtTime(0, now, ramp);
		ctx.listener.upY.setTargetAtTime(1, now, ramp);
		ctx.listener.upZ.setTargetAtTime(0, now, ramp);
	}

	dispose(): void {
		if (this.ctx) {
			this.ctx.close();
			this.ctx = null;
		}
		this.refCount = 0;
	}
}
