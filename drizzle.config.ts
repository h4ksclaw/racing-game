import type { Config } from "drizzle-kit";

export default {
	schema: "./src/server/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.DB_PATH || "./data/game_assets.db",
	},
} satisfies Config;
