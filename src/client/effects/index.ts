/**
 * Visual effects package — tire smoke, dirt throw, skid marks.
 *
 * Entry point: VehicleEffects
 *   - TireSmoke: white/gray smoke from sliding tires (handbrake, cornering, burnout)
 *   - DirtThrow: brown/green dirt from off-road wheels
 *   - SkidMarks: dark marks painted on road surface
 *   - ParticleSystem: low-level GPU particle pool (used by TireSmoke and DirtThrow)
 */

export { DirtThrow } from "./DirtThrow.ts";
export { ParticleSystem } from "./ParticleSystem.ts";
export { SkidMarks } from "./SkidMarks.ts";
export { TireSmoke } from "./TireSmoke.ts";
export { VehicleEffects } from "./VehicleEffects.ts";
