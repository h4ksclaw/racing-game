import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
	root: ".",
	publicDir: "public",
	build: {
		outDir: "dist",
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		port: 3000,
		open: true,
	},
	resolve: {
		alias: {
			"@client": resolve(__dirname, "src/client"),
			"@server": resolve(__dirname, "src/server"),
			"@shared": resolve(__dirname, "src/shared"),
		},
	},
});
