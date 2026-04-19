/**
 * PM2 ecosystem config for the racing game dev environment.
 *
 * Runs: Vite dev server, Express API server.
 * Direct access on http://localhost:3000
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop racing-game
 *   pm2 logs racing-game
 *   pm2 delete racing-game
 */

const path = require("path");

const GAME_DIR = __dirname;

module.exports = {
	apps: [
		{
			name: "racing-vite",
			script: "npx",
			args: "vite --host 0.0.0.0 --port 3000",
			cwd: GAME_DIR,
			watch: false,
			autorestart: true,
			max_restarts: 20,
			restart_delay: 3000,
			env: {
				NODE_ENV: "development",
			},
		},
		{
			name: "racing-api",
			script: "node",
			args: "--import tsx src/server/index.ts",
			cwd: GAME_DIR,
			watch: false,
			autorestart: true,
			max_restarts: 20,
			restart_delay: 3000,
			env: {
				NODE_ENV: "development",
			},
		},
	],
};
