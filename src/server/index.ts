/**
 * Minimal Express lobby server for party code management.
 */

import express from "express";

interface LobbyRoom {
	partyCode: string;
	hostPeerId: string;
	players: { peerId: string; name: string }[];
	selectedMap: string;
	createdAt: number;
}

const app = express();
app.use(express.json());

const lobbies = new Map<string, LobbyRoom>();

/** Generate a 6-character alphanumeric party code */
function generateCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Create a new lobby
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

// Join an existing lobby
app.post("/api/lobby/:code/join", (req, res) => {
	const { code } = req.params;
	const { peerId, playerName = "Player" } = req.body;

	const lobby = lobbies.get(code.toUpperCase());
	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}

	if (lobby.players.length >= 8) {
		res.status(403).json({ error: "Lobby is full" });
		return;
	}

	if (lobby.players.some((p) => p.peerId === peerId)) {
		res.status(409).json({ error: "Already in lobby" });
		return;
	}

	lobby.players.push({ peerId, name: playerName });
	res.json({ lobby });
});

// Get lobby state
app.get("/api/lobby/:code", (req, res) => {
	const lobby = lobbies.get(req.params.code.toUpperCase());
	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}
	res.json({ lobby });
});

// Leave lobby
app.post("/api/lobby/:code/leave", (req, res) => {
	const { code } = req.params;
	const { peerId } = req.body;
	const lobby = lobbies.get(code.toUpperCase());

	if (!lobby) {
		res.status(404).json({ error: "Lobby not found" });
		return;
	}

	lobby.players = lobby.players.filter((p) => p.peerId !== peerId);

	if (lobby.players.length === 0) {
		lobbies.delete(code.toUpperCase());
	}

	res.json({ lobby });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
	console.log(`Lobby server running on http://localhost:${PORT}`);
});
