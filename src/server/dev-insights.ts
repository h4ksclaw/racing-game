/**
 * Dev Insights API — serves dependency graph data and schema info.
 *
 * Only active when NODE_ENV !== production.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as schema from "./schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const router = express.Router();

/**
 * GET /api/dev-insights/dependencies
 *
 * Returns the dependency-cruiser JSON for the src/ directory.
 * Cached: runs depcruise on first call, returns cached result.
 */
let _depCache: string | null = null;

router.get("/dependencies", (_req, res) => {
	try {
		if (!_depCache) {
			const configPath = path.join(PROJECT_ROOT, ".dependency-cruiser.cjs");
			if (!existsSync(configPath)) {
				res.status(503).json({ error: ".dependency-cruiser.cjs not found" });
				return;
			}
			_depCache = execSync(`npx depcruise src --config .dependency-cruiser.cjs --output-type json`, {
				cwd: PROJECT_ROOT,
				timeout: 30_000,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		}
		res.type("json").send(_depCache);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		const stderr = (err as Record<string, unknown>)?.stderr;
		res.status(500).json({ error: msg, stderr: stderr ? String(stderr) : undefined });
	}
});

/**
 * GET /api/dev-insights/schema
 *
 * Returns the Drizzle schema as a structured object for ER diagram rendering.
 * Extracted directly from the schema.ts definitions — self-maintaining.
 */
router.get("/schema", (_req, res) => {
	const tables = [
		extractTableInfo("assets", schema.assets),
		extractTableInfo("car_metadata", schema.carMetadata),
		extractTableInfo("car_configs", schema.carConfigs),
		extractTableInfo("attributions", schema.attributions),
	];
	const relations = [
		{ from: "assets", to: "car_configs", type: "1:N", field: "asset_id" },
		{ from: "assets", to: "car_metadata", type: "1:N", field: "asset_id" },
		{ from: "car_metadata", to: "car_configs", type: "1:N", field: "car_metadata_id" },
		{ from: "assets", to: "attributions", type: "1:N", field: "asset_id" },
		{ from: "car_configs", to: "attributions", type: "1:N", field: "car_config_id" },
	];
	res.json({ tables, relations });
});

/**
 * GET /api/dev-insights/endpoints
 *
 * Returns all registered API routes from the Express app.
 * Extracted at startup from the app's route stack.
 */
export function registerEndpointDiscovery(app: express.Express) {
	router.get("/endpoints", (_req, res) => {
		const routes = extractRoutes(app);
		res.json(routes);
	});
}

// ── Helpers ────────────────────────────────────────────────────────────

interface ColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	primaryKey: boolean;
	default?: string;
	references?: string;
}

interface TableInfo {
	name: string;
	columns: ColumnInfo[];
	indexes: string[];
}

function extractTableInfo(tableName: string, table: unknown): TableInfo {
	const columns: ColumnInfo[] = [];
	const entries = Object.entries(table as Record<string, unknown>);
	for (const [colName, colDef] of entries) {
		if (typeof colDef !== "object" || colDef === null || !("dataType" in colDef)) continue;
		const def = colDef as Record<string, unknown>;
		columns.push({
			name: String(colName),
			type: String(def.dataType || def.columnType || "unknown"),
			nullable: !def.notNull,
			primaryKey: !!def.primary,
			default: def.default !== undefined ? String(def.default) : undefined,
			references: def.reference
				? `${(def.reference as Record<string, unknown>).table}.${(def.reference as Record<string, unknown>).column}`
				: undefined,
		});
	}
	return {
		name: tableName,
		columns,
		indexes: [],
	};
}

function extractRoutes(app: express.Express): Array<{ method: string; path: string }> {
	const routes: Array<{ method: string; path: string }> = [];
	// Express 5: app.router is a Router function with .stack; Express 4: app._router has .stack
	const router =
		(app as unknown as Record<string, unknown>).router ?? (app as unknown as Record<string, unknown>)._router;
	const stack = (router as Record<string, unknown>).stack as Array<Record<string, unknown>> | undefined;
	if (!stack) return routes;

	function walk(layer: Record<string, unknown>) {
		const route = layer.route as Record<string, Record<string, unknown>> | undefined;
		if (!route?.methods) return;
		const methods = Object.keys(route.methods).filter((m) => m !== "_all");
		for (const method of methods) {
			const path = String(route.path);
			if (!path) continue;
			routes.push({ method: method.toUpperCase(), path });
		}
	}

	for (const layer of stack) {
		walk(layer);
	}

	return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

export default router;
