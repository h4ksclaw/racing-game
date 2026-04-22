/**
 * Frontend serving — dev (Vite middleware) and production (static files).
 */
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import express from "express";
import type { ViteDevServer } from "vite";

const PAGES = ["editor", "practice", "garage", "world"] as const;

export async function setupFrontend(app: Express, projectRoot: string, distPath: string) {
	const isDev = !fs.existsSync(distPath);
	let vite: ViteDevServer | null = null;

	if (isDev) {
		const { createServer: createViteServer } = await import("vite");
		vite = await createViteServer({
			server: { middlewareMode: true },
			appType: "spa",
			root: projectRoot,
		});

		// Page routes BEFORE vite middleware so they take priority
		for (const page of PAGES) {
			app.get(`/${page}`, async (req, res) => {
				const html = fs.readFileSync(path.join(projectRoot, `pages/${page}.html`), "utf-8");
				res
					.set("Content-Type", "text/html")
					.status(200)
					.end(await vite!.transformIndexHtml(req.url, html));
			});
		}

		// Vite middleware handles /src/*, /node_modules/*, etc.
		app.use(vite.middlewares);
	} else {
		app.use(express.static(distPath));

		// Clean URL routing — maps /editor, /practice, /garage, /world
		for (const page of PAGES) {
			app.get(`/${page}`, (_req, res) => {
				res.sendFile(`pages/${page}.html`, { root: distPath });
			});
		}

		// SPA fallback for client-side routes (non-API)
		app.get("/{*splat}", (_req, res) => {
			res.sendFile("pages/world.html", { root: distPath });
		});
	}
}
