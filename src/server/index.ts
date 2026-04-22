/**
 * Express lobby server.
 *
 * - Lobby management: /api/lobby
 * - Track generation: /api/world
 * - Asset management: /api/assets
 * - Car metadata: /api/cars
 * - Serves frontend static files from dist/ in production
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { generateTrack } from "../shared/track.ts";
import { createUploadMiddleware, processUploadedFile, promoteAsset, serveAsset } from "./assets.ts";
import { _getDbForTesting, insertCarImport } from "./db.js";
import {
	deleteAttribution,
	filterCars,
	getAllAttributions,
	getAllCars,
	getAssetByHash,
	getAssetById,
	getAssets,
	getCarById,
	getCarConfigById,
	getCarConfigs,
	getCarConfigsByAsset,
	insertAsset,
	insertAttribution,
	saveCarConfig,
	searchCars,
	updateAttribution,
} from "./db.ts";
import { predict_specs } from "./predictor.ts";
import { carModelKey, getFromS3, uploadToS3 } from "./s3.ts";
import { downloadModel, searchModels } from "./sketchfab.ts";

/** Merge predictions into a car if ?predict=true was requested. */
/** Map flat PredictedSpecs keys into nested CarMetadata fields. */
function applyPredictions(car: ReturnType<typeof getCarById>, p: ReturnType<typeof predict_specs>) {
	const result = { ...car };
	if (p.cd != null) result.aero = { ...result.aero, drag_coefficient: p.cd };
	if (p.wheelbase_m != null) result.dimensions = { ...result.dimensions, wheelbase_m: p.wheelbase_m };
	if (p.weight_front_pct != null) result.weightFrontPct = p.weight_front_pct;
	if (p.gear_ratios != null)
		result.transmission = {
			...result.transmission,
			gear_ratios: p.gear_ratios.ratios,
			final_drive: p.gear_ratios.final_drive,
		};
	if (p.suspension_front != null) result.suspension = { ...result.suspension, front_type: p.suspension_front };
	if (p.suspension_rear != null) result.suspension = { ...result.suspension, rear_type: p.suspension_rear };
	return result;
}

function maybePredict(car: ReturnType<typeof getCarById>, predict: boolean) {
	if (!predict || !car) return car;
	return applyPredictions(car, predict_specs(car));
}

/** Merge predictions into a list of cars. */
function maybePredictList(cars: ReturnType<typeof getAllCars>, predict: boolean) {
	if (!predict) return cars;
	return cars.map((car) => applyPredictions(car, predict_specs(car)));
}

// Load .env (before creating Express app)
config();

// ── Types ─────────────────────────────────────────────────────────────────

interface LobbyRoom {
	partyCode: string;
	hostPeerId: string;
	players: { peerId: string; name: string }[];
	selectedMap: string;
	createdAt: number;
}

// ── App ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const lobbies = new Map<string, LobbyRoom>();

function generateCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ── Lobby routes ─────────────────────────────────────────────────────────

app.post("/api/lobby", (req, res) => {
	const { hostPeerId, playerName = "Host", selectedMap = "map1" } = req.body;
	if (!hostPeerId) {
		res.status(400).json({ error: "hostPeerId required" });
		return;
	}
	const partyCode = generateCode();
	const lobby: LobbyRoom = {
		partyCode,
		hostPeerId,
		players: [{ peerId: hostPeerId, name: playerName }],
		selectedMap,
		createdAt: Date.now(),
	};
	lobbies.set(partyCode, lobby);
	res.json({ partyCode, lobby });
});

app.post("/api/lobby/:code/join", (req, res) => {
	const lobby = lobbies.get(req.params.code.toUpperCase());
	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}
	if (lobby.players.length >= 8) {
		res.status(403).json({ error: "Lobby is full" });
		return;
	}
	const { peerId, playerName = "Player" } = req.body;
	if (lobby.players.some((p) => p.peerId === peerId)) {
		res.status(409).json({ error: "Already in lobby" });
		return;
	}
	lobby.players.push({ peerId, name: playerName });
	res.json({ lobby });
});

app.get("/api/lobby/:code", (req, res) => {
	const lobby = lobbies.get(req.params.code.toUpperCase());
	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}
	res.json({ lobby });
});

app.post("/api/lobby/:code/leave", (req, res) => {
	const lobby = lobbies.get(req.params.code.toUpperCase());
	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}
	lobby.players = lobby.players.filter((p) => p.peerId !== req.body.peerId);
	if (lobby.players.length === 0) lobbies.delete(req.params.code.toUpperCase());
	res.json({ lobby });
});

// ── Track route ──────────────────────────────────────────────────────────

app.get("/api/world", (req, res) => {
	const seed = Number(req.query.seed) || 42;
	const data = generateTrack(seed, {
		width: Number(req.query.width) || undefined,
		elevation: Number(req.query.elevation) || undefined,
		tightness: Number(req.query.tightness) || undefined,
		downhillBias: Number(req.query.downhillBias) || undefined,
	});
	// Strip heavy arrays that client rebuilds from samples
	const response = {
		controlPoints3D: data.controlPoints3D,
		samples: data.samples,
		splinePoints: data.splinePoints,
		length: data.length,
		numControlPoints: data.numControlPoints,
		numSamples: data.numSamples,
		elevationRange: data.elevationRange,
		seed,
	};
	res.json(response);
});

const upload = createUploadMiddleware();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// ── Asset routes ──────────────────────────────────────────────────────

/** Upload a GLB file. Returns hash and asset ID. */
app.post("/api/assets/upload", upload.single("model"), (req, res) => {
	if (!req.file) {
		res.status(400).json({ error: "No file uploaded (use field name 'model')" });
		return;
	}
	try {
		const processed = processUploadedFile(req.file.path, req.file.originalname);
		const existing = getAssetByHash(processed.hash);
		if (existing) {
			// Idempotent: same file already exists
			res.json({
				hash: processed.hash,
				assetId: existing.id,
				status: existing.status,
				originalName: existing.original_name,
				message: "File already exists",
			});
			return;
		}
		const assetId = insertAsset({
			filepath: processed.filePath,
			sha256_hash: processed.hash,
			source_url: `upload://${processed.hash}`,
			source_type: "upload",
			original_name: processed.originalName,
			status: "pending",
		});
		res.json({
			hash: processed.hash,
			assetId,
			status: "pending",
			originalName: processed.originalName,
			size: processed.size,
		});
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** List assets, optionally filtered by status. */
app.get("/api/assets", (req, res) => {
	const status = req.query.status as string | undefined;
	const assets = getAssets(status);
	res.json(assets);
});

/** Get pending (untracked) assets. Must be before /:id route. */
app.get("/api/assets/pending", (_req, res) => {
	try {
		const pendingDir = path.join(PROJECT_ROOT, "data", "assets", "pending");
		if (!fs.existsSync(pendingDir)) {
			res.json([]);
			return;
		}
		const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith(".glb"));
		const result = files.map((f) => {
			const hash = path.basename(f, ".glb");
			const dbAsset = getAssetByHash(hash);
			const stat = fs.statSync(path.join(pendingDir, f));
			return {
				hash,
				originalName: dbAsset?.original_name ?? f,
				status: dbAsset?.status ?? "untracked",
				sourceUrl: dbAsset?.source_url ?? null,
				size: stat.size,
			};
		});
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Get single asset by ID. */
app.get("/api/assets/:id", (req, res) => {
	const asset = getAssetById(Number(req.params.id));
	if (!asset) {
		res.status(404).json({ error: "Asset not found" });
		return;
	}
	res.json(asset);
});

/** Serve asset file by hash. */
app.get("/api/assets/file/:hash", serveAsset);

/** Proxy Sketchfab search — CC-licensed, downloadable models only. */
app.get("/api/sketchfab/search", async (req, res) => {
	const q = req.query.q as string;
	if (!q || q.length < 2) {
		res.status(400).json({ error: "Query too short (min 2 chars)" });
		return;
	}
	try {
		const data = await searchModels(q, {
			limit: Number(req.query.limit) || 24,
			cursor: req.query.cursor as string | undefined,
			sort_by: (req.query.sort_by as string) || "-likeCount",
			tags: req.query.tags as string | undefined,
			categories: (req.query.categories as string) || "cars-vehicles",
		});
		res.json(data);
	} catch (err) {
		res.status(502).json({ error: `Sketchfab search failed: ${String(err)}` });
	}
});

/** Download a Sketchfab model by UID. Validates license, format, size.
 *
 * Uses the sketchfab module for license validation, GLB download, and attribution.
 */
app.post("/api/sketchfab/download", async (req, res) => {
	const { uid } = req.body;
	if (!uid) {
		res.status(400).json({ error: "uid is required" });
		return;
	}

	try {
		const { buffer, filename, size, attribution } = await downloadModel(uid);

		// Write to pending directory
		const pendingDir = process.env.ASSET_DIR
			? path.join(process.env.ASSET_DIR, "pending")
			: path.join(process.cwd(), "data", "assets", "pending");
		fs.mkdirSync(pendingDir, { recursive: true });

		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
		const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
		const destPath = path.join(pendingDir, `${safeName}`);
		fs.writeFileSync(destPath, buffer);

		// Register in DB with full attribution
		const assetId = insertAsset({
			filepath: destPath,
			sha256_hash: sha256,
			source_url: attribution.sourceUrl,
			source_type: "sketchfab",
			license: attribution.license,
			attribution: `"${attribution.name}" by ${attribution.author}`,
			original_name: safeName,
			status: "pending",
			metadata_json: JSON.stringify(attribution),
		});

		// Auto-create attribution entry
		insertAttribution({
			asset_id: assetId,
			source_type: "sketchfab",
			model_name: attribution.name || uid,
			author_name: attribution.author ?? undefined,
			author_url: attribution.authorUrl ?? undefined,
			license_label: attribution.license ?? undefined,
			license_slug: attribution.licenseSlug ?? undefined,
			source_url: attribution.sourceUrl ?? `https://sketchfab.com/3d-models/${uid}`,
			license_url: undefined,
		});

		res.json({
			assetId,
			hash: sha256,
			name: safeName,
			size,
			status: "pending",
			attribution,
			message: "Downloaded to pending — open in editor to classify",
		});
	} catch (err) {
		const msg = String(err);
		const status = msg.includes("not Creative Commons")
			? 403
			: msg.includes("too large")
				? 413
				: msg.includes("not a valid GLB")
					? 415
					: msg.includes("not downloadable")
						? 403
						: msg.includes("not authorized")
							? 403
							: 500;
		res.status(status).json({ error: msg });
	}
});

/** Full car import: creates asset + config + attribution rows.
 * GLB should already be uploaded to S3 — pass the S3 key here.
 */
app.post("/api/cars/import", (req, res) => {
	const { config, modelSchema, physicsOverrides, attribution, carMetadataId, s3Key } = req.body;
	if (!s3Key || !config) {
		res.status(400).json({ error: "s3Key and config are required" });
		return;
	}
	try {
		const result = insertCarImport({
			s3Key,
			configJson: JSON.stringify(config),
			modelSchemaJson: modelSchema ? JSON.stringify(modelSchema) : undefined,
			physicsOverridesJson: physicsOverrides ? JSON.stringify(physicsOverrides) : undefined,
			attribution,
			carMetadataId: carMetadataId ? Number(carMetadataId) : undefined,
		});
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Get saved car configs for an asset. */
app.get("/api/assets/:id/configs", (req, res) => {
	const configs = getCarConfigsByAsset(Number(req.params.id));
	res.json(configs);
});

// ── Car metadata routes ──────────────────────────────────────────────

/** Search car metadata by make/model name. */
app.get("/api/cars/search", (req, res) => {
	const q = req.query.q as string;
	if (!q || q.length < 2) {
		res.status(400).json({ error: "Query too short (min 2 chars)" });
		return;
	}
	const limit = Math.min(Number(req.query.limit) || 20, 50);
	const cars = searchCars(q, limit);
	res.json(maybePredictList(cars, req.query.predict === "true"));
});

/** List all cars in the database. */
app.get("/api/cars", (_req, res) => {
	res.json(getAllCars());
});

/** Filter cars by specific fields. */
app.get("/api/cars/filter", (req, res) => {
	const filters: Record<string, unknown> = {};
	if (req.query.drivetrain) filters.drivetrain = String(req.query.drivetrain);
	if (req.query.body_type) filters.body_type = String(req.query.body_type);
	if (req.query.min_year) filters.min_year = Number(req.query.min_year);
	if (req.query.max_year) filters.max_year = Number(req.query.max_year);
	if (req.query.min_power_hp) filters.min_power_hp = Number(req.query.min_power_hp);
	if (req.query.max_power_hp) filters.max_power_hp = Number(req.query.max_power_hp);
	if (req.query.min_weight_kg) filters.min_weight_kg = Number(req.query.min_weight_kg);
	if (req.query.max_weight_kg) filters.max_weight_kg = Number(req.query.max_weight_kg);
	if (req.query.eras) filters.eras = String(req.query.eras);
	if (req.query.tag) filters.tag = String(req.query.tag);
	if (req.query.limit) filters.limit = Number(req.query.limit);
	const cars = filterCars(filters);
	res.json(maybePredictList(cars, req.query.predict === "true"));
});

/** List all saved car configs. MUST be before /api/cars/:id to avoid param capture. */
app.get("/api/cars/configs", (_req, res) => {
	res.json(getCarConfigs());
});

/** Save a car config (CarConfig JSON + optional CarModelSchema). */
app.post("/api/cars/config", (req, res) => {
	const { assetId, config, modelSchema, carMetadataId } = req.body;
	if (!assetId || !config) {
		res.status(400).json({ error: "assetId and config are required" });
		return;
	}
	// Verify asset exists
	const asset = getAssetById(Number(assetId));
	if (!asset) {
		res.status(404).json({ error: "Asset not found" });
		return;
	}
	try {
		const configId = saveCarConfig(
			Number(assetId),
			JSON.stringify(config),
			modelSchema ? JSON.stringify(modelSchema) : undefined,
			carMetadataId ? Number(carMetadataId) : undefined,
		);
		// Promote asset from pending to ready
		if (asset.status === "pending") {
			promoteAsset(asset.sha256_hash);
		}
		res.json({ configId, status: "saved" });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Get a saved car config by ID. MUST be before /api/cars/:id. */
app.get("/api/cars/config/:id", (req, res) => {
	const config = getCarConfigById(Number(req.params.id));
	if (!config) {
		res.status(404).json({ error: "Config not found" });
		return;
	}
	res.json(config);
});

/** Get predicted specs for a car by ID. */
app.get("/api/cars/:id/predicted", (req, res) => {
	const car = getCarById(Number(req.params.id));
	if (!car) {
		res.status(404).json({ error: "Car not found" });
		return;
	}
	res.json(predict_specs(car));
});

/** Get single car metadata by ID. Optionally include predictions with ?predict=true. */
/** Car database stats — field coverage, source breakdown, body type distribution. */
app.get("/api/cars/stats", (_req, res) => {
	const cars = getAllCars();
	const total = cars.length;

	// Source breakdown
	const sources: Record<string, number> = {};
	for (const c of cars) {
		sources[c.source] = (sources[c.source] ?? 0) + 1;
	}

	// Body type distribution
	const bodies: Record<string, number> = {};
	for (const c of cars) {
		const b = c.bodyType || "unknown";
		bodies[b] = (bodies[b] ?? 0) + 1;
	}

	// Field coverage (non-null, non-empty)
	const fields: Record<string, { count: number; pct: number }> = {};
	const check = (name: string, val: unknown) => {
		if (
			val !== null &&
			val !== undefined &&
			val !== "" &&
			!(typeof val === "object" && Object.keys(val as object).length === 0)
		) {
			fields[name] = { count: (fields[name]?.count ?? 0) + 1, pct: 0 };
		}
	};
	for (const c of cars) {
		check("weight", c.weightKg);
		check("weight_front_pct", c.weightFrontPct);
		check("dimensions", c.dimensions);
		check("engine", c.engine);
		check("performance", c.performance);
		check("transmission", c.transmission);
		check("drivetrain", c.drivetrain);
		check("body_type", c.bodyType);
		check("tires", c.tires);
		check("aero", c.aero);
		check("brakes", c.brakes);
		check("suspension", c.suspension);
		check("fuel_type", c.fuelType);
	}
	for (const f of Object.values(fields)) {
		f.pct = Math.round((f.count / total) * 100);
	}

	res.json({ total, sources, bodies, fields });
});

/** Random car (with optional prediction). Useful for testing/preview. */
app.get("/api/cars/random", (req, res) => {
	const cars = getAllCars();
	if (cars.length === 0) {
		res.status(404).json({ error: "No cars in database" });
		return;
	}
	const car = cars[Math.floor(Math.random() * cars.length)];
	res.json(maybePredict(car, req.query.predict === "true"));
});

/** Get all cars ready for in-game use (have S3 models). */
app.get("/api/cars/game", (_req, res) => {
	const db = _getDbForTesting();
	const rows = db
		.prepare(`
			SELECT cc.id AS configId, cc.asset_id AS assetId,
				cc.config_json, cc.model_schema_json, cc.physics_overrides_json,
				a.s3_key
			FROM car_configs cc
			JOIN assets a ON a.id = cc.asset_id
			WHERE a.s3_key IS NOT NULL
			ORDER BY cc.created_date DESC
		`)
		.all() as Record<string, unknown>[];
	res.json(rows);
});

app.get("/api/cars/:id", (req, res) => {
	const car = getCarById(Number(req.params.id));
	if (!car) {
		res.status(404).json({ error: "Car not found" });
		return;
	}
	res.json(maybePredict(car, req.query.predict === "true"));
});

// ── S3 proxy & upload routes ──────────────────────────────────────

/** Serve a private S3 object by key (e.g. cars/abc123.glb). */
app.get(/^\/api\/s3\/(.+)$/, async (req, res) => {
	const key = (req.params as Record<string, string>)[0];
	if (!key || key.includes("..")) {
		res.status(400).json({ error: "Invalid key" });
		return;
	}
	try {
		const buf = await getFromS3(key);
		const ct = key.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream";
		res.setHeader("Content-Type", ct);
		res.setHeader("Content-Length", buf.length);
		res.send(buf);
	} catch (err) {
		console.error("[s3] fetch failed:", err);
		res.status(404).json({ error: "Not found in S3" });
	}
});

/** Upload a GLB to S3 under cars/{hash}.glb. */
app.post("/api/s3/upload", upload.single("model"), async (req, res) => {
	if (!req.file) {
		res.status(400).json({ error: "No file uploaded (use field name 'model')" });
		return;
	}
	try {
		const buf = await readFile(req.file.path);
		const key = carModelKey(buf);
		await uploadToS3(key, buf);
		res.json({ key, size: buf.length });
	} catch (err) {
		console.error("[s3] upload failed:", err);
		res.status(500).json({ error: String(err) });
	}
});

// ── Error handling ──────────────────────────────────────────────────

// ── Attribution routes ──────────────────────────────────────────────

/** List all attributions. */
app.get("/api/attributions", (_req, res) => {
	res.json(getAllAttributions());
});

/** Get single attribution by ID. */
app.get("/api/attributions/:id", (req, res) => {
	const all = getAllAttributions();
	const attr = all.find((a) => a.id === Number(req.params.id));
	if (!attr) {
		res.status(404).json({ error: "Attribution not found" });
		return;
	}
	res.json(attr);
});

/** Create attribution. */
app.post("/api/attributions", (req, res) => {
	try {
		const id = insertAttribution(req.body);
		res.status(201).json({ id, status: "created" });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Update attribution. */
app.put("/api/attributions/:id", (req, res) => {
	try {
		updateAttribution(Number(req.params.id), req.body);
		res.json({ status: "updated" });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Delete attribution. */
app.delete("/api/attributions/:id", (req, res) => {
	try {
		deleteAttribution(Number(req.params.id));
		res.json({ status: "deleted" });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Generate plain-text attribution file. */
app.get("/api/attribution.txt", (_req, res) => {
	const attributions = getAllAttributions();
	const lines: string[] = [];
	lines.push("Racing Game - Asset Attributions");
	lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
	lines.push("================================");
	lines.push("");

	attributions.forEach((a, i) => {
		lines.push(`${i + 1}. ${a.model_name || "Unknown Model"}`);
		if (a.author_name) lines.push(`   Author: ${a.author_name}`);
		if (a.license_label) {
			const licUrl = a.license_url ? ` (${a.license_url})` : "";
			lines.push(`   License: ${a.license_label}${licUrl}`);
		}
		if (a.source_url) lines.push(`   Source: ${a.source_url}`);
		if (a.description) lines.push(`   ${a.description}`);
		if (a.notes) lines.push(`   Notes: ${a.notes}`);
		lines.push("");
	});

	lines.push("================================");
	lines.push(`Total: ${attributions.length} assets`);

	res.type("text/plain").send(lines.join("\n"));
});

/** Multer/file upload errors. */
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
	if (err instanceof multer.MulterError) {
		res.status(400).json({ error: `Upload error: ${err.message}` });
		return;
	}
	if (err instanceof Error && err.message.includes("Only .glb")) {
		res.status(400).json({ error: err.message });
		return;
	}
	next(err);
});

// ── Serve frontend (production) ──────────────────────────────────────

const projectRoot = PROJECT_ROOT;
const distPath = path.join(projectRoot, "dist");

// In dev, Vite proxies /api here and serves frontend itself.
// In production, Express serves both.
if (fs.existsSync(distPath)) {
	app.use(express.static(distPath));
}

// Clean URL routing: /world → world.html, /practice → practice.html
// Only in production (dist/ exists)
if (fs.existsSync(distPath)) {
	app.get("/world", (_req, res) => {
		res.sendFile(path.join(distPath, "world.html"));
	});
	app.get("/practice", (_req, res) => {
		res.sendFile(path.join(distPath, "practice.html"));
	});
	app.get("/garage", (_req, res) => {
		res.sendFile(path.join(distPath, "garage.html"));
	});
	app.get("/physics-debug", (_req, res) => {
		res.sendFile(path.join(distPath, "physics-debug.html"));
	});
}

// Fallback 404 (registered last so all routes get a chance to match)
app.use((_req, res) => {
	res.status(404).json({ error: "Not found" });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
