/**
 * Express lobby server.
 *
 * - Lobby management: /api/lobby
 * - Track generation: /api/world
 * - Asset management: /api/assets
 * - Car metadata: /api/cars
 * - Serves frontend static files from dist/ in production
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { generateTrack } from "../shared/track.ts";
import { createUploadMiddleware, processUploadedFile, promoteAsset, serveAsset } from "./assets.ts";
import { _getDbForTesting, insertCarImport } from "./db.js";
import {
	deleteAsset,
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
	if (p.suspension_front != null)
		result.suspension = {
			...result.suspension,
			front_type: p.suspension_front,
		};
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
			// Skip assets that have been imported (status = 'ready' or 'imported')
			if (dbAsset && (dbAsset.status === "ready" || dbAsset.status === "imported")) return null;
			const stat = fs.statSync(path.join(pendingDir, f));
			// Parse attribution from metadata_json
			let attribution: string | null = null;
			let attributionData: Record<string, unknown> | null = null;
			if (dbAsset?.metadata_json) {
				try {
					attributionData = JSON.parse(dbAsset.metadata_json);
					// Build attribution string from parsed data
					if (attributionData && (attributionData.name || attributionData.author)) {
						attribution = `"${attributionData.name || "Unknown"}" by ${attributionData.author || "Unknown"}`;
						if (attributionData.license) attribution += ` (${attributionData.license})`;
						if (attributionData.sourceUrl) attribution += ` - ${attributionData.sourceUrl}`;
					}
				} catch {
					/* ignore parse errors */
				}
			}
			// Fallback to DB attribution column
			if (!attribution && dbAsset?.attribution) {
				attribution = dbAsset.attribution;
			}
			return {
				hash,
				originalName: dbAsset?.original_name ?? f,
				status: dbAsset?.status ?? "untracked",
				sourceUrl: dbAsset?.source_url ?? null,
				attribution,
				size: stat.size,
			};
		});
		res.json(result.filter(Boolean));
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

/** Serve a baked car GLB from S3 (or local fallback). MUST be before /:id wildcard. */
app.get("/api/assets/s3/{*key}", async (req: express.Request, res: express.Response) => {
	const key = (Array.isArray(req.params.key) ? req.params.key.join("/") : req.params.key) as string;
	try {
		const { getFromS3 } = await import("./s3.js");
		const buffer = await getFromS3(key);
		res.setHeader("Content-Type", "model/gltf-binary");
		res.setHeader("Cache-Control", "public, max-age=31536000");
		res.send(buffer);
	} catch (err) {
		console.error(`[s3] Failed to fetch ${key}:`, err);
		res.status(404).json({ error: `S3 object not found: ${key}` });
	}
});

/** Serve asset file by hash. */
app.get("/api/assets/file/:hash", serveAsset);

/** Get single asset by ID. */
app.get("/api/assets/:id", (req, res) => {
	const asset = getAssetById(Number(req.params.id));
	if (!asset) {
		res.status(404).json({ error: "Asset not found" });
		return;
	}
	res.json(asset);
});

/** Delete an asset by hash (removes file + DB record + attributions). */
app.delete("/api/assets/:hash", (req, res) => {
	const hash = req.params.hash as string;
	try {
		const dbAsset = getAssetByHash(hash);
		if (!dbAsset) {
			res.status(404).json({ error: "Asset not found" });
			return;
		}
		// Delete DB record + related data
		deleteAsset(dbAsset.id);
		// Delete the file from disk
		const filePath = dbAsset.filepath;
		if (filePath && fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
		// Also delete .meta.json if it exists
		const metaPath = filePath.replace(/\.glb$/, ".meta.json");
		if (fs.existsSync(metaPath)) {
			fs.unlinkSync(metaPath);
		}
		res.json({ status: "deleted", hash });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

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
		const { buffer, filename, attribution } = await downloadModel(uid);

		// Use the same hash-based storage as file uploads
		const tmpPath = path.join(os.tmpdir(), `sketchfab-${Date.now()}.glb`);
		fs.writeFileSync(tmpPath, buffer);
		const processed = processUploadedFile(tmpPath, filename);
		fs.unlinkSync(tmpPath);

		// Register in DB with full attribution
		const existing = getAssetByHash(processed.hash);
		if (existing) {
			res.json({
				assetId: existing.id,
				hash: processed.hash,
				name: processed.originalName,
				size: processed.size,
				status: existing.status,
				attribution,
				message: "Already downloaded",
			});
			return;
		}
		const assetId = insertAsset({
			filepath: processed.filePath,
			sha256_hash: processed.hash,
			source_url: attribution.sourceUrl,
			source_type: "sketchfab",
			license: attribution.license,
			attribution: `"${attribution.name}" by ${attribution.author}`,
			original_name: processed.originalName,
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
			hash: processed.hash,
			name: processed.originalName,
			size: processed.size,
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

// TODO: Admin-only guard — restrict these endpoints to authenticated admin users

/** List all imported car configs (for editor re-open). */
app.get("/api/cars/imported", (_req, res) => {
	const configs = getCarConfigs();
	const enriched = configs.map((c) => {
		const asset = getAssetById(c.asset_id);
		let meta = null;
		if (c.car_metadata_id) meta = getCarById(c.car_metadata_id);
		return {
			id: c.id,
			name: meta ? `${meta.make} ${meta.model}` : (asset?.original_name?.replace(/\.glb$/, "") ?? `Car #${c.id}`),
			status: asset?.status ?? "unknown",
			s3Key: asset?.s3_key,
			createdAt: c.created_date,
			carName: meta ? `${meta.make} ${meta.model}` : null,
			attribuption: c.attribution ?? asset?.attribution ?? null,
		};
	});
	res.json(enriched);
});

/** Get a car config for editing (returns full schema + physics overrides). */
app.get("/api/cars/imported/:id", (req, res) => {
	const config = getCarConfigById(Number(req.params.id));
	if (!config) {
		res.status(404).json({ error: "Car config not found" });
		return;
	}
	const asset = getAssetById(config.asset_id);
	let meta = null;
	if (config.car_metadata_id) meta = getCarById(config.car_metadata_id);
	res.json({
		id: config.id,
		config: JSON.parse(config.config_json),
		schema: config.model_schema_json ? JSON.parse(config.model_schema_json) : null,
		physicsOverrides: config.physics_overrides_json ? JSON.parse(config.physics_overrides_json) : null,
		attribution: config.attribution ?? asset?.attribution ?? null,
		s3Key: asset?.s3_key,
		carName: meta ? `${meta.make} ${meta.model}` : null,
		carMetadataId: config.car_metadata_id,
	});
});

/** Get a full playable CarConfig assembled from saved import data. */
app.get("/api/cars/playable/:id", (req, res) => {
	const config = getCarConfigById(Number(req.params.id));
	if (!config) {
		res.status(404).json({ error: "Config not found" });
		return;
	}

	// Parse stored data
	const chassis = JSON.parse(config.config_json);
	const schema = config.model_schema_json ? JSON.parse(config.model_schema_json) : undefined;
	const physicsOverrides = config.physics_overrides_json ? JSON.parse(config.physics_overrides_json) : undefined;

	// Find the S3 key from the asset
	const asset = getAssetById(config.asset_id);
	const s3Key = asset?.s3_key;
	if (!s3Key) {
		res.status(500).json({ error: "No S3 key for this car" });
		return;
	}

	// Enrich with car metadata if linked
	let meta = null;
	if (config.car_metadata_id) {
		meta = getCarById(config.car_metadata_id);
	}

	// Build full CarConfig
	const predicted = meta ? predict_specs(meta) : {};
	const engine = meta?.engine;
	const weight = meta?.weightKg ?? chassis.mass ?? 1200;

	const fullConfig: Record<string, unknown> = {
		name: asset?.original_name?.replace(/\.glb$/, "") ?? "Imported Car",
		drivetrain: meta?.drivetrain ?? "RWD",
		modelPath: `/api/assets/s3/${s3Key}`,
		modelScale: 1, // scale is baked into the GLB
		engine: {
			torqueNm: engine?.torque_nm ?? 150,
			idleRPM: 850,
			maxRPM: engine?.max_rpm ?? 6500,
			redlinePct: 0.85,
			finalDrive: 4.1,
			torqueCurve: [
				[850, 0.3],
				[1500, 0.55],
				[3000, 0.85],
				[4800, 1.0],
				[6200, 0.98],
				[7600, 0.85],
			],
			engineBraking: 0.25,
		},
		gearbox: {
			gearRatios: predicted.gear_ratios ?? [3.59, 2.06, 1.38, 1.0, 0.85],
			shiftTime: 0.15,
			downshiftThresholds: [15, 35, 55, 75, 100],
		},
		brakes: {
			maxBrakeG: 0.8,
			handbrakeG: 1.2,
			brakeBias: 0.55,
		},
		tires: {
			corneringStiffnessFront: 80000,
			corneringStiffnessRear: 75000,
			peakFriction: 1.0,
			tractionPct: 0.25,
		},
		drag: {
			rollingResistance: 1.5,
			aeroDrag: predicted.cd ?? 0.44,
		},
		chassis: {
			...chassis,
			mass: weight,
			cgHeight: chassis.cgHeight ?? 0.35,
			weightFront: predicted.weight_front_pct ?? meta?.weightFrontPct ?? chassis.weightFront ?? 0.55,
		},
	};

	// Merge physics overrides on top
	if (physicsOverrides) {
		fullConfig.physicsOverrides = physicsOverrides;
	}

	// Include schema for VehicleRenderer
	if (schema) {
		fullConfig.schema = schema;
	}

	res.json(fullConfig);
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
		.prepare(
			`
			SELECT cc.id AS configId, cc.asset_id AS assetId,
				cc.config_json, cc.model_schema_json, cc.physics_overrides_json,
				a.s3_key
			FROM car_configs cc
			JOIN assets a ON a.id = cc.asset_id
			WHERE a.s3_key IS NOT NULL
			ORDER BY cc.created_date DESC
		`,
		)
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

/** Upload a GLB to S3 under cars/{hash}.glb. Uses memory storage — no disk write needed. */
const s3Upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 50 * 1024 * 1024 },
});

app.post("/api/s3/upload", s3Upload.single("model"), async (req, res) => {
	if (!req.file) {
		res.status(400).json({ error: "No file uploaded (use field name 'model')" });
		return;
	}
	try {
		const buf = req.file.buffer;
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

// ── Frontend serving & start ────────────────────────────────────────

const distPath = path.join(PROJECT_ROOT, "dist");

async function main() {
	// Frontend: Vite middleware (dev) or static files (prod)
	const { setupFrontend } = await import("./frontend.ts");
	await setupFrontend(app, PROJECT_ROOT, distPath);

	// Fallback 404 (registered last so all routes get a chance to match)
	app.use((_req, res) => {
		res.status(404).json({ error: "Not found" });
	});

	const PORT = Number(process.env.PORT ?? 3000);
	app.listen(PORT, () => {
		console.log(`Server running on http://localhost:${PORT}`);
	});
}
main().catch(console.error);
