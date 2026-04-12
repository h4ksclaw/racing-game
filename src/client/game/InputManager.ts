/**
 * Input manager for keyboard and gamepad.
 */

import type { ControlState } from "@shared/types.ts";

export class InputManager {
	private state: ControlState = {
		forward: false,
		backward: false,
		left: false,
		right: false,
		handbrake: false,
		reset: false,
	};

	private keyDownHandler: (e: KeyboardEvent) => void;
	private keyUpHandler: (e: KeyboardEvent) => void;

	constructor() {
		this.keyDownHandler = this.onKeyDown.bind(this);
		this.keyUpHandler = this.onKeyUp.bind(this);
	}

	listen(): void {
		window.addEventListener("keydown", this.keyDownHandler);
		window.addEventListener("keyup", this.keyUpHandler);
	}

	getState(): ControlState {
		// Poll gamepad and merge with keyboard state
		this.pollGamepad();
		return { ...this.state };
	}

	private pollGamepad(): void {
		const gamepads = navigator.getGamepads();
		for (const gp of gamepads) {
			if (!gp) continue;

			this.state.forward = this.state.forward || gp.buttons[7]?.pressed;
			this.state.backward = this.state.backward || gp.buttons[6]?.pressed;
			this.state.left = this.state.left || gp.axes[0] < -0.3;
			this.state.right = this.state.right || gp.axes[0] > 0.3;
			this.state.handbrake = this.state.handbrake || gp.buttons[4]?.pressed;
			this.state.reset = this.state.reset || gp.buttons[16]?.pressed;
			break; // Use first gamepad only
		}
	}

	private keyMap: Record<string, keyof ControlState> = {
		KeyW: "forward",
		ArrowUp: "forward",
		KeyS: "backward",
		ArrowDown: "backward",
		KeyA: "left",
		ArrowLeft: "left",
		KeyD: "right",
		ArrowRight: "right",
		Space: "handbrake",
		KeyR: "reset",
	};

	private onKeyDown(e: KeyboardEvent): void {
		const control = this.keyMap[e.code];
		if (control) {
			this.state[control] = true;
			e.preventDefault();
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		const control = this.keyMap[e.code];
		if (control) {
			this.state[control] = false;
		}
	}

	dispose(): void {
		window.removeEventListener("keydown", this.keyDownHandler);
		window.removeEventListener("keyup", this.keyUpHandler);
	}
}
