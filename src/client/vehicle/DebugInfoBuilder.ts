/**
 * DebugInfoBuilder — builds the debug overlay data from vehicle state.
 */

import type { TireDynamicsState } from "./tires/TireDynamics.ts";

export interface WheelDebugInfo {
	wheelIsInContact: (i: number) => boolean;
	wheelSuspensionLength: (i: number) => number | null;
	wheelSuspensionRestLength: (i: number) => number | null;
	wheelSuspensionForce: (i: number) => number | null;
}

export interface DebugInfoInput {
	pos: { x: number; y: number; z: number };
	vel: { x: number; y: number; z: number };
	angvel: { x: number; y: number; z: number };
	heading: number;
	pitch: number;
	roll: number;
	speed: number;
	rpm: number;
	steerAngle: number;
	gear: number;
	contacts: number;
	suspRestLength: number;
	wheelRadius: number;
	wheelY: number;
	patchCenterX?: number;
	patchCenterZ?: number;
	guardrailCount: number;
	tireDynState: TireDynamicsState | null;
	halfExtentsY: number;
	wheel: WheelDebugInfo;
}

export function buildDebugInfo(input: DebugInfoInput): Record<string, unknown> {
	const { pos, vel, angvel: av, heading, pitch, roll, speed, rpm, steerAngle, contacts, wheel } = input;
	const wheelData: string[] = [];
	const suspData: string[] = [];
	const wheelBotYs: string[] = [];
	for (let i = 0; i < 4; i++) {
		wheelData.push(wheel.wheelIsInContact(i) ? "●" : "○");
		const currentLen = wheel.wheelSuspensionLength(i);
		const restLen = wheel.wheelSuspensionRestLength(i);
		const suspForce = wheel.wheelSuspensionForce(i);
		if (currentLen !== null && restLen !== null) {
			const compression = restLen - currentLen;
			const forceStr = suspForce !== null ? `${(suspForce / 1000).toFixed(0)}kN` : "?";
			suspData.push(`${compression.toFixed(3)}m/${forceStr}`);
			const anchorY = -input.halfExtentsY;
			const wbY = pos.y + anchorY - currentLen - input.wheelRadius;
			wheelBotYs.push(wbY.toFixed(3));
		} else {
			suspData.push("-");
			wheelBotYs.push("?");
		}
	}
	return {
		pos: `${pos.x.toFixed(1)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(1)}`,
		vel: `${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}`,
		angvel: `${av.x.toFixed(3)}, ${av.y.toFixed(3)}, ${av.z.toFixed(3)}`,
		heading: `${((heading * 180) / Math.PI).toFixed(1)}°`,
		pitch: `${((pitch * 180) / Math.PI).toFixed(2)}°`,
		roll: `${((roll * 180) / Math.PI).toFixed(2)}°`,
		speed: speed.toFixed(1),
		speedKmh: `${(Math.abs(speed) * 3.6).toFixed(0)}`,
		rpm: rpm.toFixed(0),
		gear: input.gear,
		steer: `${((steerAngle * 180) / Math.PI).toFixed(1)}°`,
		contacts: `${contacts}/4 [${wheelData.join(" ")}]`,
		susp: `[${suspData.join(" | ")}]`,
		suspRest: input.suspRestLength,
		wheelBotY: `[${wheelBotYs.join(" ")}]`,
		wheelRadius: input.wheelRadius,
		wheelY: input.wheelY,
		patchCenter: `${input.patchCenterX?.toFixed(0) ?? "?"}, ${input.patchCenterZ?.toFixed(0) ?? "?"}`,
		guardrails: input.guardrailCount,
		...(input.tireDynState
			? {
					rearGrip: input.tireDynState.rearGripMultiplier.toFixed(2),
					drifting: input.tireDynState.isDrifting ? "YES" : "no",
					driftTorque: input.tireDynState.driftYawTorque.toFixed(1),
					comLocal: `${input.tireDynState.localCOM.x.toFixed(2)}, ${input.tireDynState.localCOM.y.toFixed(2)}, ${input.tireDynState.localCOM.z.toFixed(2)}`,
				}
			: {}),
	};
}
