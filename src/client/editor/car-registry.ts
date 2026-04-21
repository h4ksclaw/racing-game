/**
 * Client-side car registry — fetches import-ready cars from the DB.
 *
 * Caches results in memory; call invalidateCache() after imports.
 */

export interface CarRegistryEntry {
	configId: number;
	assetId: number;
	config_json: string;
	model_schema_json: string | null;
	physics_overrides_json: string | null;
	s3_key: string;
}

let cache: CarRegistryEntry[] | null = null;

/** Fetch all cars ready for in-game use (have S3 models). Cached after first call. */
export async function fetchGameCars(): Promise<CarRegistryEntry[]> {
	if (cache) return cache;
	const res = await fetch("/api/cars/game");
	if (!res.ok) throw new Error(`Failed to fetch game cars: ${res.status}`);
	cache = (await res.json()) as CarRegistryEntry[];
	return cache;
}

/** Clear the cache so the next fetch hits the server. */
export function invalidateCarCache(): void {
	cache = null;
}
