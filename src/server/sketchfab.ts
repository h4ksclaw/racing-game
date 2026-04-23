/**
 * Sketchfab API client — search, details, and download for CC-licensed 3D models.
 *
 * Extracted from index.ts to keep routes thin.
 */

const API_ROOT = "https://api.sketchfab.com/v3";

// ── CC license slugs for API filter ──
const CC_LICENSE_SLUGS = "by";

// ── CC license UIDs we accept for validation ──
const CC_LICENSE_UIDS = new Set([
	"322a749bcfa841b29dff1e8a1bb74b0b", // CC Attribution (CC BY)
	"bbfe3f7dbcdd4122b966b85b9786a989", // CC Attribution-NonCommercial (CC BY-NC)
]);

export function isCcLicense(uid?: string): boolean {
	return !!uid && CC_LICENSE_UIDS.has(uid);
}

// ── Types ──

export interface SearchResult {
	uid: string;
	name: string;
	thumbnail: string | null;
	viewCount: number;
	likeCount: number;
	faceCount: number;
	vertexCount: number;
	license: string;
	licenseSlug: string;
	author: string;
	url: string;
	downloadable: boolean;
	estimatedSize?: number; // bytes, if available from API
	isCc: boolean;
	createdAt?: string; // ISO date for sorting
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	nextCursor: string | null;
}

export interface ModelDetails {
	uid: string;
	name: string;
	description?: string;
	license: { label: string; slug: string; requireAttribution?: boolean };
	user: { displayName: string; username?: string };
	thumbnails: {
		images: Array<{ url: string; width?: number; height?: number }>;
	};
	vertexCount: number;
	faceCount: number;
	likeCount: number;
	viewCount: number;
	downloadCount?: number;
	createdAt?: string;
	isDownloadable: boolean;
	/** If downloadable, the download options available. */
	downloadOptions?: Array<{ format: string; size?: number; url?: string }>;
	/** Tags on the model. */
	tags?: string[];
}

export interface AttributionData {
	uid: string;
	name: string;
	author: string;
	authorUrl: string;
	license: string;
	licenseSlug: string;
	sourceUrl: string;
	requireAttribution: boolean;
	tags?: string[];
}

// ── Helpers ──

function authHeaders(): Record<string, string> {
	const key = process.env.SKETCHFAB_API_KEY;
	return key ? { Authorization: `Token ${key}` } : {};
}

// ── API functions ──

/**
 * Search Sketchfab for CC-licensed, downloadable 3D models.
 */
export async function searchModels(
	query: string,
	options?: {
		limit?: number;
		cursor?: string;
		sort_by?: string;
		tags?: string;
		categories?: string;
	},
): Promise<SearchResponse> {
	const limit = Math.min(options?.limit ?? 24, 50);
	const sort_by = options?.sort_by ?? "-likeCount";
	const categories = options?.categories ?? "cars-vehicles";

	const params = new URLSearchParams({
		q: query,
		downloadable: "true",
		sort_by,
		count: String(limit),
		categories,
		license: CC_LICENSE_SLUGS,
		...(options?.cursor ? { cursor: options.cursor } : {}),
		...(options?.tags ? { tags: options.tags } : {}),
	});

	const resp = await fetch(`${API_ROOT}/search?type=models&${params}`);
	if (!resp.ok) throw new Error(`Sketchfab search error: ${resp.status}`);

	const data = (await resp.json()) as {
		results?: Array<{
			uid?: string;
			name?: string;
			thumbnails?: { images?: Array<{ url?: string }> };
			viewCount?: number;
			likeCount?: number;
			faceCount?: number;
			vertexCount?: number;
			license?: { label?: string; slug?: string; uid?: string };
			user?: { displayName?: string };
			createdAt?: string;
		}>;
		totalResults?: number;
		cursors?: { next?: string };
	};

	const results: SearchResult[] = (data.results || []).map((m) => {
		const licUid =
			(m.license as { uid?: string; slug?: string } | undefined)?.uid ??
			(m.license as { uid?: string; slug?: string } | undefined)?.slug ??
			"";
		return {
			uid: m.uid ?? "",
			name: m.name ?? "Unnamed",
			thumbnail: m.thumbnails?.images?.[0]?.url ?? null,
			viewCount: m.viewCount ?? 0,
			likeCount: m.likeCount ?? 0,
			faceCount: m.faceCount ?? 0,
			vertexCount: m.vertexCount ?? 0,
			license: m.license?.label ?? "Unknown",
			licenseSlug: licUid,
			author: m.user?.displayName ?? "",
			url: `https://sketchfab.com/3d-models/${m.uid}`,
			downloadable: true,
			isCc: isCcLicense(licUid),
			createdAt: m.createdAt,
		};
	});

	return {
		results,
		total: data.totalResults ?? results.length,
		nextCursor: data.cursors?.next ?? null,
	};
}

/**
 * Get full model details by UID.
 */
export async function getModelDetails(uid: string): Promise<ModelDetails> {
	const resp = await fetch(`${API_ROOT}/models/${uid}`, {
		headers: authHeaders(),
	});
	if (!resp.ok) throw new Error(`Sketchfab model details error: ${resp.status}`);
	const data = (await resp.json()) as Record<string, unknown>;
	const m = data as Record<string, unknown>;
	const license = (m.license ?? {}) as Record<string, unknown>;
	const user = (m.user ?? {}) as Record<string, unknown>;
	const thumbnails = (m.thumbnails ?? {}) as Record<string, unknown>;
	const images = (thumbnails.images ?? []) as Array<Record<string, unknown>>;

	return {
		uid: uid,
		name: String(m.name ?? ""),
		description: m.description ? String(m.description) : undefined,
		license: {
			label: String(license.label ?? "Unknown"),
			slug: String(license.slug ?? ""),
			requireAttribution: license.requireAttribution !== false,
		},
		user: {
			displayName: String(user.displayName ?? user.username ?? ""),
			username: user.username ? String(user.username) : undefined,
		},
		thumbnails: {
			images: images.map((img) => ({
				url: String(img.url ?? ""),
				width: img.width ? Number(img.width) : undefined,
				height: img.height ? Number(img.height) : undefined,
			})),
		},
		vertexCount: Number(m.vertexCount ?? 0),
		faceCount: Number(m.faceCount ?? 0),
		likeCount: Number(m.likeCount ?? 0),
		viewCount: Number(m.viewCount ?? 0),
		downloadCount: m.downloadCount ? Number(m.downloadCount) : undefined,
		createdAt: m.createdAt ? String(m.createdAt) : undefined,
		isDownloadable: m.isDownloadable === true,
		tags: Array.isArray(m.tags) ? m.tags.map(String) : undefined,
	};
}

/**
 * Get the GLB download URL for a model.
 * Returns the best GLB option with size info.
 */
export async function getDownloadUrl(
	uid: string,
): Promise<{ url: string; format: string; size: number; filename?: string }> {
	const apiKey = process.env.SKETCHFAB_API_KEY;
	if (!apiKey) throw new Error("SKETCHFAB_API_KEY not configured");

	const resp = await fetch(`${API_ROOT}/models/${uid}/download`, {
		headers: { Authorization: `Token ${apiKey}` },
	});
	if (!resp.ok) {
		if (resp.status === 403) throw new Error("Model download not authorized");
		throw new Error(`Sketchfab download API error: ${resp.status}`);
	}

	const data = (await resp.json()) as Record<string, unknown>;

	// API v3 returns { glb: { url }, gltf: { url }, source: { url, size } }
	const glb = data.glb as Record<string, unknown> | undefined;
	const gltf = data.gltf as Record<string, unknown> | undefined;
	const source = data.source as Record<string, unknown> | undefined;

	// Prefer direct GLB, fall back to glTF, then source
	const url = String(glb?.url ?? gltf?.url ?? source?.url ?? "");
	if (!url) throw new Error("No download URL available");

	const size = Number(source?.size ?? 0);
	const isGltf = !glb?.url && !!gltf?.url;

	return { url, format: isGltf ? "gltf" : "glb", size, filename: undefined };
}

/**
 * Full download pipeline: validate license → get download URL → download → attribution.
 */
export async function downloadModel(uid: string): Promise<{
	buffer: Buffer;
	filename: string;
	size: number;
	attribution: AttributionData;
}> {
	// 1. Get model details for license check + attribution
	const details = await getModelDetails(uid);

	if (!details.isDownloadable) {
		throw new Error("Model is not downloadable");
	}

	// 2. Get download URL
	const dl = await getDownloadUrl(uid);

	// 3. Download the file
	const fileResp = await fetch(dl.url);
	if (!fileResp.ok) throw new Error(`GLB download failed: ${fileResp.status}`);

	const arrayBuf = await fileResp.arrayBuffer();
	const buf = Buffer.from(arrayBuf);
	const size = buf.byteLength;

	// 4. Validate size (< 100MB)
	const MAX_SIZE = 100 * 1024 * 1024;
	if (size > MAX_SIZE) {
		throw new Error(`File too large: ${(size / 1048576).toFixed(1)} MB (max 100 MB)`);
	}

	// 5. Validate GLB magic bytes
	if (buf.length < 4 || buf.toString("ascii", 0, 4) !== "glTF") {
		throw new Error("Downloaded file is not a valid GLB");
	}

	// 6. Build attribution
	const filename = dl.filename || `${details.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.glb`;
	const attribution: AttributionData = {
		uid,
		name: details.name,
		author: details.user.displayName,
		authorUrl: details.user.username ? `https://sketchfab.com/${details.user.username}` : "",
		license: details.license.label,
		licenseSlug: details.license.slug,
		sourceUrl: `https://sketchfab.com/3d-models/${uid}`,
		requireAttribution: details.license.requireAttribution !== false,
		tags: details.tags,
	};

	return { buffer: buf, filename, size, attribution };
}
