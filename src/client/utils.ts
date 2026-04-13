import type { TrackSample } from "@shared/track.ts";

export interface V3 {
	x: number;
	y: number;
	z: number;
}

export interface TrackResponse {
	controlPoints3D: V3[];
	samples: TrackSample[];
	splinePoints: V3[];
	length: number;
	numControlPoints: number;
	numSamples: number;
	elevationRange: { min: number; max: number };
	seed: number;
	maxExtent: number;
}

export interface TimeKeyframe {
	hour: number;
	sunColor: [number, number, number];
	sunIntensity: number;
	sunElevation: number;
	ambientColor: [number, number, number];
	ambientIntensity: number;
	fogColor: [number, number, number];
	fogNear: number;
	fogFar: number;
	turbidity: number;
	rayleigh: number;
	starsOpacity: number;
}

export type WeatherType = "clear" | "cloudy" | "rain" | "heavy_rain" | "fog" | "snow";

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}
