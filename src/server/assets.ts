/**
 * Asset upload and storage handler.
 *
 * Manages GLB file uploads with SHA256 deduplication.
 * Files stored in ASSET_DIR (env var, default: ./data/assets).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const DEFAULT_ASSET_DIR = path.join(PROJECT_ROOT, "data", "assets");

function getAssetDir(): string {
	return process.env.ASSET_DIR || DEFAULT_ASSET_DIR;
}

/** Compute SHA256 hash of a buffer. */
export function hashBuffer(buf: Buffer): string {
	return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Ensure asset directories exist. */
export function ensureAssetDirs(): void {
	const base = getAssetDir();
	fs.mkdirSync(path.join(base, "pending"), { recursive: true });
	fs.mkdirSync(path.join(base, "ready"), { recursive: true });
}

/** Get file path for an asset by hash and status. */
export function getAssetPath(hash: string, status: "pending" | "ready" = "ready"): string {
	return path.join(getAssetDir(), status, `${hash}.glb`);
}

/** Get pending file path for a hash. */
export function getPendingPath(hash: string): string {
	return `${getAssetDir()}/pending/${hash}.glb`;
}

/** Get ready file path for a hash. */
export function getReadyPath(hash: string): string {
	return `${getAssetDir()}/ready/${hash}.glb`;
}

/** Move asset from pending to ready. */
export function promoteAsset(hash: string): string {
	const pending = getPendingPath(hash);
	const ready = getReadyPath(hash);
	fs.renameSync(pending, ready);
	return ready;
}

/** Configure multer for GLB uploads. */
export function createUploadMiddleware(): multer.Multer {
	ensureAssetDirs();
	const storage = multer.diskStorage({
		destination: (_req, _file, cb) => {
			cb(null, path.join(getAssetDir(), "pending"));
		},
		filename: (_req, file, cb) => {
			const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
			cb(null, safeName);
		},
	});

	return multer({
		storage,
		limits: { fileSize: 40 * 1024 * 1024 },
		fileFilter: (_req, file, cb) => {
			const ext = path.extname(file.originalname).toLowerCase();
			if (ext === ".glb" || ext === ".gltf") {
				cb(null, true);
			} else {
				cb(new Error("Only .glb and .gltf files allowed"));
			}
		},
	});
}

export interface ProcessedUpload {
	hash: string;
	originalName: string;
	filePath: string;
	size: number;
}

export function processUploadedFile(tempPath: string, originalName: string): ProcessedUpload {
	const buf = fs.readFileSync(tempPath);
	const hash = hashBuffer(buf);
	const hashPath = getPendingPath(hash);

	if (tempPath !== hashPath) {
		fs.mkdirSync(path.dirname(hashPath), { recursive: true });
		fs.renameSync(tempPath, hashPath);
		if (fs.existsSync(tempPath) && tempPath !== hashPath) {
			fs.unlinkSync(tempPath);
		}
	}

	// Save metadata for name-based lookup
	const metaPath = hashPath.replace(/\.glb$/, ".meta.json");
	fs.writeFileSync(metaPath, JSON.stringify({ originalName, size: buf.length }));

	return { hash, originalName, filePath: hashPath, size: buf.length };
}

/** Resolve an original filename to a hash by scanning metadata files. */
function resolveByName(name: string): { hash: string; filePath: string; originalName: string } | null {
	const base = getAssetDir();
	for (const dir of ["pending", "ready"]) {
		const dirPath = path.join(base, dir);
		if (!fs.existsSync(dirPath)) continue;
		for (const file of fs.readdirSync(dirPath)) {
			if (!file.endsWith(".meta.json")) continue;
			try {
				const meta = JSON.parse(fs.readFileSync(path.join(dirPath, file), "utf-8"));
				const h = file.replace(/\.meta\.json$/, "");
				if (meta.originalName === name || meta.originalName?.replace(/\.(glb|gltf)$/i, "") === name) {
					return {
						hash: h,
						filePath: path.join(dirPath, `${h}.glb`),
						originalName: meta.originalName,
					};
				}
			} catch {
				/* skip corrupt meta */
			}
		}
	}
	return null;
}

/** Serve asset files by hash or original name. */
export function serveAsset(req: Request, res: Response): void {
	let hash = String(req.params.hash);

	// If not a valid 64-char hex hash, try resolving by original name
	if (!/^[a-f0-9]{64}$/.test(hash)) {
		const resolved = resolveByName(hash);
		if (!resolved) {
			res.status(404).json({ error: "Asset not found" });
			return;
		}
		hash = resolved.hash;
	}

	// Try ready first, then pending
	let filePath = getReadyPath(hash);
	if (!fs.existsSync(filePath)) {
		filePath = getPendingPath(hash);
	}
	if (!fs.existsSync(filePath)) {
		res.status(404).json({ error: "Asset not found" });
		return;
	}

	res.setHeader("Content-Type", "model/gltf-binary");
	res.setHeader("Content-Disposition", `inline; filename="${hash}.glb"`);
	const stream = fs.createReadStream(filePath);
	stream.pipe(res);
	stream.on("error", () => {
		if (!res.headersSent) res.status(500).json({ error: "Failed to read asset" });
	});
}
