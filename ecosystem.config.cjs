/**
 * PM2 ecosystem config for the racing game dev environment.
 *
 * Runs: Vite dev server, Express API server, Cloudflare tunnel.
 * Cloudflare tunnel URL is extracted and saved to /tmp/racing-tunnel-url.
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
			script: "npx",
			args: "tsx src/server/index.ts",
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
			name: "racing-tunnel",
			script: "cloudflared",
			args: "tunnel --url http://127.0.0.1:3000",
			autorestart: true,
			max_restarts: 999,
			restart_delay: 5000,
			kill_timeout: 5000,
			// PM2 tracks the tunnel URL via a post-start hook
			post_start: `${path.join(GAME_DIR, "tunnel-watch.sh")}`,
		},
	],
};
