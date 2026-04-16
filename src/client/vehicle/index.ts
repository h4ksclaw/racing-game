/**
 * Vehicle module — re-exports.
 */

export { DragModel } from "./aero/DragModel.ts";
export { Chassis } from "./chassis/Chassis.ts";
// Types and configs
export {
	type BrakeSpec,
	type CarConfig,
	type ChassisSpec,
	type DragSpec,
	type EngineSpec,
	type GearboxSpec,
	RACE_CAR,
	SEDAN_CAR,
	SPORTS_CAR,
	type TireSpec,
} from "./configs.ts";
export { Engine } from "./engine/Engine.ts";
// Subsystems
export { EngineUnit } from "./engine/EngineUnit.ts";
export { Gearbox } from "./engine/Gearbox.ts";
export { Brakes } from "./suspension/Brakes.ts";
export { TireModel } from "./suspension/TireModel.ts";
export {
	DEFAULT_INPUT,
	type EngineTelemetry,
	type RoadBoundaryInfo,
	type TerrainProvider,
	type VehicleInput,
	type VehicleState,
	type WheelVisual,
} from "./types.ts";
// Composition root
export { VehicleController } from "./VehicleController.ts";
export { VehiclePhysics } from "./VehiclePhysics.ts";
export { VehicleRenderer } from "./VehicleRenderer.ts";
export { TerrainHandler, type TerrainSample } from "./world/TerrainHandler.ts";
