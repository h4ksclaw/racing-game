/**
 * S3 storage module for game assets (MinIO).
 *
 * Provides upload, download, delete, listing, and presigned URLs
 * against a private S3-compatible bucket. Uses path-style addressing.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Agent as HttpsAgent } from "node:https";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ── Client singleton ────────────────────────────────────────────────────

let client: S3Client | null = null;

/** Reset cached client (for testing). */
export function _resetClient(): void {
	client = null;
}

/** Create (or return cached) S3Client from env vars. */
export function initS3Client(): S3Client {
	if (client) return client;

	const endpoint = process.env.S3_ENDPOINT;
	if (!endpoint) throw new Error("S3_ENDPOINT not set");

	const opts: ConstructorParameters<typeof S3Client>[0] = {
		endpoint,
		region: process.env.S3_REGION || "us-east-1",
		credentials: {
			accessKeyId: process.env.S3_ACCESS_KEY || "",
			secretAccessKey: process.env.S3_SECRET_KEY || "",
		},
		forcePathStyle: process.env.S3_USE_PATH_STYLE !== "false",
	};

	// Allow self-signed certs (common for tunneled/local MinIO)
	if (process.env.S3_SKIP_TLS_VERIFY !== "false") {
		opts.requestHandler = new NodeHttpHandler({
			httpsAgent: new HttpsAgent({ rejectUnauthorized: false }),
		});
	}

	client = new S3Client(opts);
	return client;
}

function bucket(): string {
	return process.env.S3_BUCKET || "game-assets";
}

// ── Upload ──────────────────────────────────────────────────────────────

/** Upload a buffer to S3. Returns the key. */
export async function uploadToS3(key: string, buffer: Buffer, contentType?: string): Promise<string> {
	const s3 = initS3Client();
	const ct = contentType ?? guessContentType(key);
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: buffer,
			ContentType: ct,
		}),
	);
	return key;
}

/** Upload a file from disk to S3. Returns the key. */
export async function uploadFromDisk(key: string, filePath: string, contentType?: string): Promise<string> {
	const data = await readFile(filePath);
	return uploadToS3(key, data, contentType);
}

// ── Download ────────────────────────────────────────────────────────────

/** Download an object from S3 into a Buffer. */
export async function getFromS3(key: string): Promise<Buffer> {
	const s3 = initS3Client();
	const resp = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
	const bytes = await resp.Body?.transformToByteArray();
	if (!bytes) throw new Error(`Empty response for key: ${key}`);
	return Buffer.from(bytes);
}

// ── Delete ──────────────────────────────────────────────────────────────

/** Delete an object from S3. */
export async function deleteFromS3(key: string): Promise<void> {
	const s3 = initS3Client();
	await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// ── Presigned URL ───────────────────────────────────────────────────────

/** Get a presigned GET URL (for internal use). Default expiry: 1 hour. */
export async function getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
	const s3 = initS3Client();
	return s3GetSignedUrl(s3, new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

// ── List ────────────────────────────────────────────────────────────────

/** List objects under a prefix. */
export async function listObjects(prefix?: string): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
	const s3 = initS3Client();
	const resp = await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix }));
	return (resp.Contents ?? []).map((o) => ({
		key: o.Key!,
		size: o.Size ?? 0,
		lastModified: o.LastModified ?? new Date(),
	}));
}

// ── Bucket check ────────────────────────────────────────────────────────

/** Check whether the configured bucket is accessible. */
export async function bucketExists(): Promise<boolean> {
	try {
		const s3 = initS3Client();
		await s3.send(new HeadBucketCommand({ Bucket: bucket() }));
		return true;
	} catch {
		return false;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Derive a storage key for a car model GLB from its file content. */
export function carModelKey(buffer: Buffer): string {
	const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
	return `cars/${hash}.glb`;
}

function guessContentType(key: string): string {
	if (key.endsWith(".glb")) return "model/gltf-binary";
	if (key.endsWith(".gltf")) return "model/gltf+json";
	if (key.endsWith(".png")) return "image/png";
	if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
	return "application/octet-stream";
}
