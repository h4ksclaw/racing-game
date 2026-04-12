import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve("/var/lib/openclaw/.openclaw/workspace/racing-game/game"),
  build: {
    outDir: resolve("/var/lib/openclaw/.openclaw/workspace/racing-game/game/public/debug-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("/var/lib/openclaw/.openclaw/workspace/racing-game/game/debug-track.html"),
    },
  },
});
