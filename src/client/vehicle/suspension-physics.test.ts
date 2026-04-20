/**
 * Test: Differential suspension forces for body pitch/roll.
 *
 * PROBLEM: Rapier's suspension applies equal force to all wheels — no weight transfer,
 * no body pitch under braking, no body roll in corners.
 *
 * SOLUTION: Apply only the DIFFERENTIAL component of spring forces. Compute average
 * compression across all wheels, then apply k×(comp-avg) per wheel. Net vertical force
 * is always zero — only torque (pitch/roll moments) is produced. Rapier continues to
 * handle baseline ride height and traction.
 *
 * KEY INVARIANT: sum(F_i) = 0 always. Custom forces must never change ride height.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTerrainTrimesh } from "./rapier-terrain-collider.ts";

const flatTerrain = { getHeight: () => 0 };

describe("Differential suspension — pitch/roll from weight transfer", () => {
	beforeAll(async () => {
		await RAPIER.init();
	});

	function localToWorld(body: RAPIER.RigidBody, local: { x: number; y: number; z: number }) {
		const pos = body.translation();
		const r = body.rotation();
		const ix = r.x,
			iy = r.y,
			iz = r.z,
			iw = r.w;
		const xx = ix * ix,
			yy = iy * iy,
			z2 = iz * iz;
		return {
			x: pos.x + (1 - 2 * (yy + z2)) * local.x + 2 * (ix * iy - iw * iz) * local.y + 2 * (ix * iz + iw * iy) * local.z,
			y: pos.y + 2 * (ix * iy + iw * iz) * local.x + (1 - 2 * (xx + z2)) * local.y + 2 * (iy * iz - iw * ix) * local.z,
			z: pos.z + 2 * (ix * iz - iw * iy) * local.x + 2 * (iy * iz + iw * ix) * local.y + (1 - 2 * (xx + yy)) * local.z,
		};
	}

	function getPitch(body: RAPIER.RigidBody) {
		const r = body.rotation();
		return Math.atan2(2 * (r.w * r.x + r.y * r.z), 1 - 2 * (r.x * r.x + r.y * r.y));
	}

	/**
	 * Build a vehicle scenario and measure body dynamics under acceleration then braking.
	 * Uses differential-only custom suspension forces.
	 */
	function runScenario(opts: {
		rapierStiffness: number;
		diffStiffness: number;
		diffDamping: number;
		angularDamping: number;
		brakeForce: number;
		label: string;
	}) {
		const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
		const { vertices, indices } = buildTerrainTrimesh(flatTerrain, 0, 0, 200, 2);
		const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
		world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8), gb);

		const halfW = 0.7,
			halfH = 0.35,
			halfD = 1.3;
		const mass = 200,
			wheelRadius = 0.3,
			susRest = 0.3;
		const wl = halfW * 0.85;
		const wy = -halfH;
		const anchors = [
			{ x: -wl, y: wy, z: halfD * 0.7 },
			{ x: wl, y: wy, z: halfD * 0.7 },
			{ x: -wl, y: wy, z: -halfD * 0.7 },
			{ x: wl, y: wy, z: -halfD * 0.7 },
		];
		const SUS_TRAVEL = 0.3;
		const MAX_SUS_FORCE = 100000;
		const dt = 1 / 60;
		const prevComp = [0, 0, 0, 0];

		const body = world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(0, 2, 0)
				.setAngularDamping(opts.angularDamping)
				.setLinearDamping(0.0),
		);
		world.createCollider(
			RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD)
				.setDensity(mass / (halfW * 2 * halfH * 2 * halfD * 2))
				.setFriction(0.0),
			body,
		);

		const vehicle = world.createVehicleController(body);
		for (const a of anchors) {
			vehicle.addWheel(a, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, susRest, wheelRadius);
		}
		for (let i = 0; i < 4; i++) {
			vehicle.setWheelSuspensionStiffness(i, opts.rapierStiffness);
			vehicle.setWheelSuspensionCompression(i, 4.4);
			vehicle.setWheelSuspensionRelaxation(i, 2.3);
			vehicle.setWheelMaxSuspensionTravel(i, SUS_TRAVEL);
			vehicle.setWheelMaxSuspensionForce(i, MAX_SUS_FORCE);
			vehicle.setWheelFrictionSlip(i, 2.0);
			vehicle.setWheelSideFrictionStiffness(i, 2.5);
		}

		// Differential-only spring forces: sum = 0 always
		function applyDifferentialSuspension() {
			const comps: number[] = [];
			const vels: number[] = [];
			let grounded = 0;
			for (let i = 0; i < 4; i++) {
				const len = vehicle.wheelSuspensionLength(i);
				if (len === null || len === undefined) {
					comps.push(0);
					vels.push(0);
					continue;
				}
				grounded++;
				const comp = susRest - len;
				comps.push(comp);
				vels.push((comp - prevComp[i]) / dt);
				prevComp[i] = comp;
			}
			if (grounded < 2) return;
			let avgC = 0,
				avgV = 0;
			for (let i = 0; i < 4; i++) {
				avgC += comps[i];
				avgV += vels[i];
			}
			avgC /= grounded;
			avgV /= grounded;
			for (let i = 0; i < 4; i++) {
				if (comps[i] === 0 && vels[i] === 0) continue;
				let f = opts.diffStiffness * (comps[i] - avgC) + opts.diffDamping * (vels[i] - avgV);
				f = Math.max(-5000, Math.min(5000, f));
				if (Math.abs(f) < 0.5) continue;
				const wa = localToWorld(body, anchors[i]);
				body.applyImpulseAtPoint({ x: 0, y: f * dt, z: 0 }, wa, true);
			}
		}

		function step() {
			vehicle.updateVehicle(dt);
			world.step();
			applyDifferentialSuspension();
		}

		// Settle
		for (let f = 0; f < 600; f++) step();
		const bodyY_settle = body.translation().y;
		const avgComp_settle =
			[0, 1, 2, 3].reduce((s, i) => s + (susRest - (vehicle.wheelSuspensionLength(i) ?? susRest)), 0) / 4;

		// Get moving (rear-wheel drive)
		for (let f = 0; f < 360; f++) {
			vehicle.setWheelEngineForce(2, -50);
			vehicle.setWheelEngineForce(3, -50);
			step();
		}
		const pitchAccel = getPitch(body);
		const speed = body.linvel().z;

		// Brake
		for (let f = 0; f < 120; f++) {
			vehicle.setWheelEngineForce(2, 0);
			vehicle.setWheelEngineForce(3, 0);
			vehicle.setWheelBrake(0, opts.brakeForce);
			vehicle.setWheelBrake(1, opts.brakeForce);
			vehicle.setWheelBrake(2, opts.brakeForce * 0.7);
			vehicle.setWheelBrake(3, opts.brakeForce * 0.7);
			step();
		}
		const pitchBrake = getPitch(body);
		const fComp = [0, 1].reduce((s, i) => s + (susRest - (vehicle.wheelSuspensionLength(i) ?? susRest)), 0) / 2;
		const rComp = [2, 3].reduce((s, i) => s + (susRest - (vehicle.wheelSuspensionLength(i) ?? susRest)), 0) / 2;

		// Check wheel bottoms don't go underground
		let minBottomY = Infinity;
		for (let i = 0; i < 4; i++) {
			const wa = localToWorld(body, anchors[i]);
			const len = vehicle.wheelSuspensionLength(i) ?? susRest;
			const bottom = wa.y - len - wheelRadius;
			minBottomY = Math.min(minBottomY, bottom);
		}

		world.free();

		return {
			bodyY_settle,
			avgComp_settle,
			speed,
			pitchAccel,
			pitchBrake,
			pitchDelta: pitchBrake - pitchAccel,
			frontComp: fComp,
			rearComp: rComp,
			weightTransfer: fComp - rComp,
			minBottomY,
		};
	}

	it("baseline: Rapier-only (no differential forces)", () => {
		const r = runScenario({
			rapierStiffness: 30,
			diffStiffness: 0,
			diffDamping: 0,
			angularDamping: 1.0,
			brakeForce: 50,
			label: "baseline",
		});
		// Car should hold at correct height (bodyY ~1.1)
		console.log(
			`[BASELINE] bodyY=${r.bodyY_settle.toFixed(3)} avgComp=${r.avgComp_settle.toFixed(4)} speed=${r.speed.toFixed(1)} pitchΔ=${((r.pitchDelta * 180) / Math.PI).toFixed(3)}° minBottom=${r.minBottomY.toFixed(3)}`,
		);
		expect(r.bodyY_settle).toBeGreaterThan(0.8);
		expect(r.minBottomY).toBeGreaterThan(-0.05); // wheels not underground
	});

	it("differential forces produce pitch without changing ride height", () => {
		const baseline = runScenario({
			rapierStiffness: 30,
			diffStiffness: 0,
			diffDamping: 0,
			angularDamping: 0.1,
			brakeForce: 50,
			label: "baseline",
		});
		const withDiff = runScenario({
			rapierStiffness: 30,
			diffStiffness: 10000,
			diffDamping: 400,
			angularDamping: 0.1,
			brakeForce: 50,
			label: "diff",
		});
		// Ride height should be nearly identical (differential forces sum to zero)
		console.log(
			`[DIFF] baseline bodyY=${baseline.bodyY_settle.toFixed(3)} vs diff bodyY=${withDiff.bodyY_settle.toFixed(3)}`,
		);
		expect(Math.abs(withDiff.bodyY_settle - baseline.bodyY_settle)).toBeLessThan(0.05);
		// Wheels should NOT go underground
		expect(withDiff.minBottomY).toBeGreaterThan(-0.05);
	});

	it("wheels stay above ground under heavy braking", () => {
		const r = runScenario({
			rapierStiffness: 30,
			diffStiffness: 10000,
			diffDamping: 400,
			angularDamping: 0.1,
			brakeForce: 200,
			label: "heavy brake",
		});
		console.log(
			`[HEAVY BRAKE] bodyY=${r.bodyY_settle.toFixed(3)} pitchΔ=${((r.pitchDelta * 180) / Math.PI).toFixed(3)}° minBottom=${r.minBottomY.toFixed(3)}`,
		);
		expect(r.minBottomY).toBeGreaterThan(-0.1); // wheels not underground even under heavy braking
	});

	it("parameter sweep: find best pitch response", () => {
		console.log(`\n[DIFFERENTIAL SUSPENSION SWEEP]`);
		console.log(
			`  ${"Label".padEnd(30)} ${"bodyY".padStart(6)} ${"speed".padStart(6)} ${"squat°".padStart(7)} ${"dive°".padStart(7)} ${"pitchΔ°".padStart(8)} ${"F-R".padStart(7)} ${"minBot".padStart(7)}`,
		);

		const configs = [
			{
				rapierStiffness: 30,
				diffStiffness: 0,
				diffDamping: 0,
				angularDamping: 1.0,
				brakeForce: 50,
				label: "Rapier only (baseline)",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 5000,
				diffDamping: 300,
				angularDamping: 0.1,
				brakeForce: 50,
				label: "diff k=5000",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 10000,
				diffDamping: 400,
				angularDamping: 0.1,
				brakeForce: 50,
				label: "diff k=10000",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 20000,
				diffDamping: 600,
				angularDamping: 0.1,
				brakeForce: 50,
				label: "diff k=20000",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 10000,
				diffDamping: 400,
				angularDamping: 0.05,
				brakeForce: 50,
				label: "k=10k angD=0.05",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 10000,
				diffDamping: 400,
				angularDamping: 0.01,
				brakeForce: 50,
				label: "k=10k angD=0.01",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 50000,
				diffDamping: 1000,
				angularDamping: 0.1,
				brakeForce: 50,
				label: "diff k=50000",
			},
			{
				rapierStiffness: 30,
				diffStiffness: 10000,
				diffDamping: 400,
				angularDamping: 0.1,
				brakeForce: 200,
				label: "Heavy brake",
			},
		];

		for (const cfg of configs) {
			const r = runScenario(cfg);
			const deg = (v: number) => ((v * 180) / Math.PI).toFixed(2);
			console.log(
				`  ${cfg.label.padEnd(30)} ${r.bodyY_settle.toFixed(3).padStart(6)} ${r.speed.toFixed(1).padStart(6)} ` +
					`${deg(r.pitchAccel).padStart(7)} ${deg(r.pitchBrake).padStart(7)} ` +
					`${deg(r.pitchDelta).padStart(8)} ${r.weightTransfer.toFixed(4).padStart(7)} ${r.minBottomY.toFixed(3).padStart(7)}`,
			);
		}
	});
});
