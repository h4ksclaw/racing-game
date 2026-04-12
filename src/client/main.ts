/**
 * Main game entry point.
 * Initializes Three.js scene, physics, input, and the game loop.
 */

import { Game } from "./game/Game.ts";

const container = document.getElementById("game-container");
if (!container) throw new Error("Missing #game-container element");

// Remove loading indicator
const loading = document.getElementById("loading");
if (loading) loading.remove();

const game = new Game(container);
game.init();

// Expose for debugging
(window as unknown as Record<string, unknown>).__GAME__ = game;
