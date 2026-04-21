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
				world: resolve(__dirname, "world.html"),
				practice: resolve(__dirname, "practice.html"),
				garage: resolve(__dirname, "garage.html"),
			editor: resolve(__dirname, "editor.html"),
			},
		},
	},
	server: {
		port: 3000,
		host: "0.0.0.0",
		allowedHosts: [".trycloudflare.com"],
		watch: {
			ignored: [
				"**/node_modules/**",
				"**/.venv/**",
				"**/__pycache__/**",
				"**/_archive/**",
				"**/CloudBot/**",
				"**/.git/**",
			],
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
