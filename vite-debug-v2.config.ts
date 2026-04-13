import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

export default defineConfig({
	root: projectRoot,
	build: {
		outDir: resolve(projectRoot, "public/debug-track-v2"),
		emptyOutDir: true,
		target: "es2020",
		sourcemap: true,
		rollupOptions: {
			input: resolve(projectRoot, "debug-track-v2.html"),
			output: {
				format: "es",
				entryFileNames: "assets/track-[hash].js",
				assetFileNames: "assets/track-[hash].[ext]",
			},
		},
	},
	resolve: {
		alias: {
			"@client": resolve(projectRoot, "src/client"),
		},
	},
});
