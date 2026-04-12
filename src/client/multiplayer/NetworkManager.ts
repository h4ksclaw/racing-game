/**
 * PeerJS network manager for P2P multiplayer.
 */

import { NETWORK } from "@shared/constants.ts";
import type { NetworkMessage } from "@shared/types.ts";
import Peer, { type DataConnection } from "peerjs";

export type NetworkRole = "host" | "client" | "none";

export class NetworkManager {
	private peer: Peer | null = null;
	private connections: Map<string, DataConnection> = new Map();
	private role: NetworkRole = "none";
	private onMessageCallback?: (msg: NetworkMessage) => void;
	private onPlayerConnectCallback?: (id: string) => void;
	private onPlayerDisconnectCallback?: (id: string) => void;

	// NETWORK exported for use by other modules
	public static readonly TICK_RATE = NETWORK.TICK_RATE;
	public static readonly CONNECTION_TIMEOUT = NETWORK.CONNECTION_TIMEOUT;
	private tickInterval: ReturnType<typeof setInterval> | null = null;

	get playerCount(): number {
		return this.connections.size + (this.role !== "none" ? 1 : 0);
	}

	/** Create a host peer */
	async host(id?: string): Promise<string> {
		this.role = "host";
		this.peer = id ? new Peer(id) : new Peer();

		return new Promise((resolve, reject) => {
			if (!this.peer) return reject(new Error("Peer not created"));

			this.peer.on("open", (peerId) => {
				resolve(peerId);
			});

			this.peer.on("connection", (conn) => {
				this.handleConnection(conn);
				this.onPlayerConnectCallback?.(conn.peer);
			});

			this.peer.on("error", reject);
		});
	}

	/** Connect to a host peer */
	async join(hostPeerId: string): Promise<void> {
		this.role = "client";
		this.peer = new Peer();

		return new Promise((resolve, reject) => {
			if (!this.peer) return reject(new Error("Peer not created"));

			this.peer.on("open", () => {
				const conn = this.peer?.connect(hostPeerId, { reliable: true });
				if (!conn) return reject(new Error("Failed to connect"));
				conn.on("open", () => {
					this.handleConnection(conn);
					resolve();
				});
				conn.on("error", reject);
			});

			this.peer.on("error", reject);
		});
	}

	private handleConnection(conn: DataConnection): void {
		conn.on("data", (data) => {
			this.onMessageCallback?.(data as NetworkMessage);
		});

		conn.on("close", () => {
			this.connections.delete(conn.peer);
			this.onPlayerDisconnectCallback?.(conn.peer);
		});

		this.connections.set(conn.peer, conn);
	}

	/** Send a message to all connected peers */
	broadcast(message: NetworkMessage): void {
		for (const conn of this.connections.values()) {
			conn.send(message);
		}
	}

	/** Send a message to a specific peer */
	send(peerId: string, message: NetworkMessage): void {
		this.connections.get(peerId)?.send(message);
	}

	onMessage(cb: (msg: NetworkMessage) => void): void {
		this.onMessageCallback = cb;
	}

	onPlayerConnect(cb: (id: string) => void): void {
		this.onPlayerConnectCallback = cb;
	}

	onPlayerDisconnect(cb: (id: string) => void): void {
		this.onPlayerDisconnectCallback = cb;
	}

	/** Get this peer's ID */
	getPeerId(): string | undefined {
		return this.peer?.id;
	}

	getRole(): NetworkRole {
		return this.role;
	}

	disconnect(): void {
		if (this.tickInterval) clearInterval(this.tickInterval);
		for (const conn of this.connections.values()) {
			conn.close();
		}
		this.connections.clear();
		this.peer?.destroy();
		this.peer = null;
		this.role = "none";
	}
}
