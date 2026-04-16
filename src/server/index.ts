/**
 * Express lobby server.
 *
 * - Lobby management: /api/lobby
 * - Track generation: /api/track
 * - Serves frontend static files from dist/ in production
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTrack } from "@shared/track.ts";
import express from "express";

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

app.get("/api/track", (req, res) => {
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

// ── Serve frontend (production) ──────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const distPath = path.join(projectRoot, "dist");

// In dev, Vite proxies /api here and serves frontend itself.
// In production, Express serves both.
app.use(express.static(distPath));

// Clean URL routing: /track → track.html, /practice → practice.html
app.get("/track", (_req, res) => {
	res.sendFile(path.join(distPath, "track.html"));
});
app.get("/practice", (_req, res) => {
	res.sendFile(path.join(distPath, "practice.html"));
});
app.get("/physics-debug", (_req, res) => {
	res.sendFile(path.join(distPath, "physics-debug.html"));
});
app.get("*path", (_req, res) => {
	res.sendFile(path.join(distPath, "track.html"));
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
