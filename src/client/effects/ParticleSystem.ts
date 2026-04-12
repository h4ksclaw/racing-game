/**
 * Particle system for tire smoke, sparks, and other effects.
 */

import {
	BufferGeometry,
	Float32BufferAttribute,
	Points,
	PointsMaterial,
	type Vector3,
} from "three";

export class ParticleSystem {
	private particles: Points;
	private velocities: Vector3[] = [];
	private lifetimes: number[] = [];
	private maxParticles: number;

	constructor(maxParticles = 200) {
		this.maxParticles = maxParticles;
		const positions = new Float32Array(maxParticles * 3);
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

		const material = new PointsMaterial({
			color: 0xcccccc,
			size: 0.5,
			transparent: true,
			opacity: 0.6,
			depthWrite: false,
		});

		this.particles = new Points(geometry, material);
	}

	getMesh(): Points {
		return this.particles;
	}

	/** Emit particles at a position with velocity */
	emit(_position: Vector3, velocity: Vector3, count = 1): void {
		for (let i = 0; i < count; i++) {
			if (this.velocities.length >= this.maxParticles) break;
			this.velocities.push(velocity.clone());
			this.lifetimes.push(1.0);
		}
	}

	/** Update particle positions and lifetimes */
	update(delta: number): void {
		// Remove expired particles
		for (let i = this.velocities.length - 1; i >= 0; i--) {
			this.lifetimes[i] -= delta;
			if (this.lifetimes[i] <= 0) {
				this.velocities.splice(i, 1);
				this.lifetimes.splice(i, 1);
			}
		}

		// TODO: update particle positions based on velocities
		const positions = this.particles.geometry.attributes.position;
		positions.needsUpdate = true;
		this.particles.geometry.setDrawRange(0, this.velocities.length);
	}

	dispose(): void {
		this.particles.geometry.dispose();
		(this.particles.material as PointsMaterial).dispose();
	}
}
