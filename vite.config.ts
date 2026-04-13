import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: ".",
	publicDir: "public",
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			input: {
				main: resolve(__dirname, "index.html"),
				track: resolve(__dirname, "track.html"),
			},
		},
	},
	server: {
		port: 3000,
		watch: {
			ignored: [
				"src/client/game/**",
				"src/client/vehicle/**",
				"src/client/multiplayer/**",
				"src/client/ui/**",
				"src/client/audio/**",
				"src/client/effects/**",
				"src/client/types/**",
				"src/client/utils/**",
				"src/client/track/**",
				"src/client/main.ts",
			],
		},
		proxy: {
			"/api": {
				target: "http://localhost:3001",
				changeOrigin: true,
			},
		},
		allowedHosts: true,
	},
	resolve: {
		alias: {
			"@client": resolve(__dirname, "src/client"),
			"@server": resolve(__dirname, "src/server"),
			"@shared": resolve(__dirname, "src/shared"),
		},
	},
});
