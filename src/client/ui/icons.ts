/**
 * SVG icon paths — reusable icon library for the editor UI.
 * All paths are from Lucide (MIT license) — https://lucide.dev
 *
 * Usage:
 *   import { svgIcon, icons } from "./icons.ts";
 *   svgIcon(icons.orbit)      // returns SVGTemplateResult for Lit
 *   svgIcon(icons.orbit, 18)  // custom size
 */
import { svg } from "lit";

export interface IconDef {
	readonly paths: string[];
	readonly size?: number;
}

/** Core editor icons */
export const icons = {
	// ── Mode buttons ──
	orbit: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
	select: ["M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3", "M13 13l6 6"],
	place: ["M12 5v14", "M5 12h14"],
	move: ["M5 9l-3 3 3 3", "M9 5l3-3 3 3", "M15 19l-3 3-3-3", "M19 9l3 3-3 3"],
	delete: [
		"M3 6h18",
		"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
		"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
		"M10 11v6",
		"M14 11v6",
	],

	// ── Toggle buttons ──
	box: [
		"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
	],
	ruler: [
		"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0z",
	],
	wand: [
		"M15 4V2",
		"M15 16v-2",
		"M8 9h2",
		"M20 9h2",
		"M17.8 11.8 19 13",
		"M17.8 6.2 19 5",
		"M12.2 11.8 11 13",
		"M12.2 6.2 11 5",
	],
	brain: [
		"M12 18V5",
		"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
		"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5",
		"M17.997 5.125a4 4 0 0 1 2.526 5.77",
		"M18 18a4 4 0 0 0 2-7.464",
		"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
		"M6 18a4 4 0 0 1-2-7.464",
		"M6.003 5.125a4 4 0 0 0-2.526 5.77",
	],
	explode: ["M5 8l4-4 4 4", "M5 16l4 4 4-4", "M12 3v5", "M12 16v5"],
	tag: ["M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z", "M7 7h.01"],
	highlights: [
		"m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08",
		"M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z",
	],
	download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],

	// ── Actions ──
	folderOpen: ["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"],
	play: ["M6 4l14 8-14 8V4"],
	settings: [
		"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
		"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
	],

	// ── View presets ──
	front: ["M12 19V5", "M5 12l7-7 7 7"],
	back: ["M12 5v14", "M19 12l-7 7-7-7"],
	top: ["M3 3h18v18H3z", "M12 3v18", "M3 12h18"],
	left: ["M12 19l-7-7 7-7"],
	right: ["M12 5l7 7-7 7"],
	fit: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
} as const satisfies Record<string, string[]>;

/**
 * Render an SVG icon as a Lit `svg` template result.
 * Safe to use inside both `html` and `svg` tagged templates.
 */
export function svgIcon(paths: string[], size = 14) {
	return svg`<svg width="${size}" height="${size}" viewBox="0 0 24 24"
		fill="none" stroke="currentColor" stroke-width="2"
		stroke-linecap="round" stroke-linejoin="round"
	>${paths.map((d) => svg`<path d="${d}" />`)}</svg>`;
}
