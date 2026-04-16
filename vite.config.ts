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
				track: resolve(__dirname, "track.html"),
				practice: resolve(__dirname, "practice.html"),
				"physics-debug": resolve(__dirname, "pages/physics-debug.html"),
			},
		},
	},
	server: {
		port: 3000,
		allowedHosts: true,
		watch: {
			ignored: ["_archive/**", "**/node_modules/**", "**/.venv/**", "**/__pycache__/**"],
		},
		proxy: {
			"/api": {
				target: "http://localhost:3001",
				changeOrigin: true,
			},
		},
	},
	resolve: {
		alias: {
			"@client": resolve(__dirname, "src/client"),
			"@server": resolve(__dirname, "src/server"),
			"@shared": resolve(__dirname, "src/shared"),
		},
	},
});
