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
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { generateTrack } from "../shared/track.ts";
import { createUploadMiddleware, processUploadedFile, promoteAsset, serveAsset } from "./assets.ts";
import {
	filterCars,
	getAllCars,
	getAssetByHash,
	getAssetById,
	getAssets,
	getCarById,
	getCarConfigById,
	getCarConfigs,
	getCarConfigsByAsset,
	insertAsset,
	saveCarConfig,
	searchCars,
} from "./db.ts";

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
	res.json(cars);
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
	res.json(cars);
});

/** Get single car metadata by ID. */
app.get("/api/cars/:id", (req, res) => {
	const car = getCarById(Number(req.params.id));
	if (!car) {
		res.status(404).json({ error: "Car not found" });
		return;
	}
	res.json(car);
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

/** Get a saved car config by ID. */
app.get("/api/cars/config/:id", (req, res) => {
	const config = getCarConfigById(Number(req.params.id));
	if (!config) {
		res.status(404).json({ error: "Config not found" });
		return;
	}
	res.json(config);
});

/** List all saved car configs. */
app.get("/api/cars/configs", (_req, res) => {
	res.json(getCarConfigs());
});

// ── Error handling ──────────────────────────────────────────────────

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
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
