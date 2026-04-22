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
				world: resolve(__dirname, "pages/world.html"),
				practice: resolve(__dirname, "pages/practice.html"),
				garage: resolve(__dirname, "pages/garage.html"),
				editor: resolve(__dirname, "pages/editor.html"),
			},
			output: {
				entryFileNames: "assets/[name]-[hash].js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
			},
		},
	},
	server: {
		port: 3000,
		host: "0.0.0.0",
		allowedHosts: [".trycloudflare.com"],
		watch: {
			usePolling: true,
			interval: 1000,
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
				target: "http://localhost:3000",
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
