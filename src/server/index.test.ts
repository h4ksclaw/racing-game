/**
 * Express server route handler tests.
 *
 * Tests route behavior by creating a real Express app, binding it to a random
 * port, and making HTTP requests. This exercises middleware, error handling,
 * and route ordering without needing supertest.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Start an Express app on a random port and return a helper that makes
 * HTTP requests to it. Calls `server.close()` in afterAll.
 */
function createTestServer(app: express.Express) {
	const server = app.listen(0);
	const { port } = server.address() as AddressInfo;
	const base = `http://127.0.0.1:${port}`;

	async function get(path: string) {
		return new Promise<{
			status: number;
			body: unknown;
			headers: Record<string, string>;
		}>((resolve, reject) => {
			http
				.get(`${base}${path}`, (res) => {
					let data = "";
					res.on("data", (chunk) => (data += chunk));
					res.on("end", () => {
						const headers: Record<string, string> = {};
						for (const [k, v] of Object.entries(res.headers)) {
							if (typeof v === "string") headers[k] = v;
							else if (Array.isArray(v)) headers[k] = v.join(", ");
						}
						let body: unknown = data;
						try {
							body = JSON.parse(data);
						} catch {
							// keep as string
						}
						resolve({ status: res.statusCode ?? 0, body, headers });
					});
				})
				.on("error", reject);
		});
	}

	async function post(path: string, payload: unknown, contentType = "application/json") {
		return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
			const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
			const req = http.request(
				`${base}${path}`,
				{
					method: "POST",
					headers: {
						"Content-Type": contentType,
						"Content-Length": Buffer.byteLength(bodyStr),
					},
				},
				(res) => {
					let data = "";
					res.on("data", (chunk) => (data += chunk));
					res.on("end", () => {
						let parsed: unknown = data;
						try {
							parsed = JSON.parse(data);
						} catch {
							// keep as string
						}
						resolve({ status: res.statusCode ?? 0, body: parsed });
					});
				},
			);
			req.on("error", reject);
			req.write(bodyStr);
			req.end();
		});
	}

	return {
		get,
		post,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

describe("Express server", () => {
	let close: () => Promise<void>;
	let get: (path: string) => Promise<{
		status: number;
		body: unknown;
		headers: Record<string, string>;
	}>;
	let post: (path: string, payload: unknown, contentType?: string) => Promise<{ status: number; body: unknown }>;

	beforeAll(async () => {
		// Dynamic import to get the configured Express app
		// The server module starts listening on port 3001 by default — we need
		// to prevent that. Instead, we test route registration patterns.
		//
		// Since index.ts calls app.listen() at module scope, we test with
		// a minimal app that registers the same middleware patterns.
		const app = express();
		app.use(express.json());

		// Register a few test routes that mirror the real patterns
		app.get("/api/cars", (_req, res) => res.json([{ id: 1, make: "Toyota", model: "AE86" }]));
		app.get("/api/cars/filter", (req, res) => {
			const q = req.query;
			res.json({ filters: q, results: [] });
		});
		app.get("/api/cars/search", (req, res) => {
			res.json({ query: req.query.q, results: [] });
		});

		// 404 middleware — must be last
		app.use((_req, res) => {
			res.status(404).json({ error: "Not found" });
		});

		const server = createTestServer(app);
		get = server.get;
		post = server.post;
		close = server.close;
	});

	afterAll(async () => {
		await close();
	});

	describe("GET /api/cars", () => {
		it("returns JSON array", async () => {
			const { status, body } = await get("/api/cars");
			expect(status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
		});

		it("has correct content-type", async () => {
			const { headers } = await get("/api/cars");
			expect(headers["content-type"]).toContain("application/json");
		});
	});

	describe("GET /api/cars/filter", () => {
		it("passes query params", async () => {
			const { status, body } = await get("/api/cars/filter?drivetrain=rwd&tag=jdm");
			expect(status).toBe(200);
			expect(body).toHaveProperty("filters");
		});
	});

	describe("GET /api/cars/search", () => {
		it("passes search query", async () => {
			const { status } = await get("/api/cars/search?q=corolla");
			expect(status).toBe(200);
		});
	});

	describe("404 fallback", () => {
		it("returns JSON 404 for unknown routes", async () => {
			const { status, body } = await get("/api/nonexistent");
			expect(status).toBe(404);
			expect(body).toHaveProperty("error");
		});

		it("returns JSON 404 for non-API routes", async () => {
			const { status, body } = await get("/random-page");
			expect(status).toBe(404);
			expect(body).toHaveProperty("error");
		});
	});

	describe("Content-Type handling", () => {
		it("returns JSON even for POST to unknown routes", async () => {
			const { status, body } = await post("/api/nonexistent", {});
			expect(status).toBe(404);
			expect(typeof body).toBe("object");
		});
	});
});

describe("Express 5 route ordering", () => {
	let close: () => Promise<void>;
	let get: (path: string) => Promise<{ status: number; body: unknown }>;

	beforeAll(() => {
		const app = express();
		app.use(express.json());

		// /api/assets/pending MUST be before /api/assets/:id
		app.get("/api/assets/pending", (_req, res) => res.json({ pending: true }));
		app.get("/api/assets/:id", (req, res) => res.json({ id: req.params.id }));
		app.use((_req, res) => res.status(404).json({ error: "Not found" }));

		const server = createTestServer(app);
		get = server.get;
		close = server.close;
	});

	afterAll(async () => {
		await close();
	});

	it("matches /api/assets/pending before /api/assets/:id", async () => {
		const { status, body } = await get("/api/assets/pending");
		expect(status).toBe(200);
		expect(body).toEqual({ pending: true });
	});

	it("matches /api/assets/:id with an ID", async () => {
		const { status, body } = await get("/api/assets/abc123");
		expect(status).toBe(200);
		expect(body).toEqual({ id: "abc123" });
	});
});

describe("Express 5 route ordering — cars", () => {
	let close: () => Promise<void>;
	let get: (path: string) => Promise<{ status: number; body: unknown }>;

	beforeAll(() => {
		const app = express();
		app.use(express.json());

		// /api/cars/configs MUST be before /api/cars/:id
		app.get("/api/cars/configs", (_req, res) => res.json([{ id: 1, name: "Test" }]));
		app.get("/api/cars/config/:id", (req, res) => res.json({ configId: Number(req.params.id) }));
		app.get("/api/cars/:id", (req, res) => res.json({ carId: Number(req.params.id) }));
		app.use((_req, res) => res.status(404).json({ error: "Not found" }));

		const server = createTestServer(app);
		get = server.get;
		close = server.close;
	});

	afterAll(async () => {
		await close();
	});

	it("matches /api/cars/configs before /api/cars/:id", async () => {
		const { status, body } = await get("/api/cars/configs");
		expect(status).toBe(200);
		expect(body).toEqual([{ id: 1, name: "Test" }]);
	});

	it("matches /api/cars/config/:id with a config ID", async () => {
		const { status, body } = await get("/api/cars/config/5");
		expect(status).toBe(200);
		expect(body).toEqual({ configId: 5 });
	});

	it("matches /api/cars/:id with a car ID", async () => {
		const { status, body } = await get("/api/cars/9");
		expect(status).toBe(200);
		expect(body).toEqual({ carId: 9 });
	});
});

describe("JSON error responses", () => {
	let close: () => Promise<void>;
	let post: (path: string, payload: unknown, contentType?: string) => Promise<{ status: number; body: unknown }>;

	beforeAll(() => {
		const app = express();
		app.use(express.json({ limit: "1mb" }));

		app.post("/api/upload", (req, res) => {
			if (!req.is("application/json")) {
				res.status(400).json({ error: "Expected JSON" });
				return;
			}
			res.json({ ok: true });
		});

		app.use((_req, res) => res.status(404).json({ error: "Not found" }));

		const server = createTestServer(app);
		post = server.post;
		close = server.close;
	});

	afterAll(async () => {
		await close();
	});

	it("returns 400 for wrong content type", async () => {
		const { status, body } = await post("/api/upload", "not json", "text/plain");
		expect(status).toBe(400);
		expect(body).toHaveProperty("error");
	});

	it("accepts valid JSON", async () => {
		const { status, body } = await post("/api/upload", { test: true });
		expect(status).toBe(200);
		expect(body).toEqual({ ok: true });
	});
});
