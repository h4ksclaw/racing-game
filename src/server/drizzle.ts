/**
 * Drizzle ORM instance wrapping better-sqlite3.
 *
 * Singleton pattern — reuses the same connection across the process.
 * Configurable via DB_PATH env var (default: ./data/game_assets.db).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, "data", "game_assets.db");

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _rawDb: Database.Database | null = null;

function initDb() {
	const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	const rawDb = new Database(dbPath);
	rawDb.pragma("journal_mode = WAL");
	rawDb.pragma("foreign_keys = ON");

	const db = drizzle(rawDb, { schema });
	_db = db;
	_rawDb = rawDb;
	return db;
}

/** Get the Drizzle ORM instance (singleton). */
export function getDrizzle() {
	if (_db) return _db;
	return initDb();
}

/** @internal Get the underlying better-sqlite3 Database handle. */
export function getRawDb(): Database.Database {
	if (!_rawDb) initDb();
	return _rawDb!;
}

/** Reset the singleton (used in tests to switch to a different DB file). */
export function resetDrizzle() {
	if (_rawDb) {
		_rawDb.close();
	}
	_db = null;
	_rawDb = null;
}
