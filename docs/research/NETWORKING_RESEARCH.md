# Networking Research — PeerJS, WebRTC, Multiplayer Patterns

## PeerJS Host-Relay Pattern

From Racez.io (`multiplayer.js`) — the only deployed multiplayer browser racing game.

### Architecture

```
                    ┌──────────────┐
                    │ PeerJS Cloud │
                    │ (signaling)  │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │   HOST     │   │  CLIENT 1  │   │  CLIENT 2  │
   │            │◄──│            │   │            │
   │  Collects  │──►│  Sends     │   │  Sends     │
   │  all state │   │  own pos   │   │  own pos   │
   │            │──►│            │   │            │
   │  Broadcast │──►│            │──►│            │
   │  combined  │   │  Receives  │   │  Receives  │
   └────────────┘   └────────────┘   └────────────┘
```

**Key design decisions:**
- **Star topology** (not mesh) — all clients connect to host only
- **Host is authoritative** — runs physics, collects all positions, broadcasts
- **No server game state** — Express only handles lobby codes before the race
- **WebRTC data channels** — direct P2P after signaling, low latency

### Connection Flow

```
1. HOST creates party
   POST /api/party/create → { code: "ABCD", peerId: "host-123" }

2. CLIENTS join party
   POST /api/party/join { code: "ABCD" } → { peerId: "client-456", players: [...] }

3. Game loads for all players
   Each player creates: new Peer(peerId)

4. CLIENTS connect to HOST
   clientConnection = peer.connect(hostPeerId)

5. HOST accepts incoming connections
   hostPeer.on('connection', (conn) => { ... })

6. Race begins
   HOST broadcasts countdown → all clients sync
```

### Retry Logic (from Racez.io)

```javascript
const MAX_RETRIES = 15;
const RETRY_TIMEOUT = 5000;  // 5 seconds per attempt
const RETRY_DELAY = 2000;    // 2 seconds between retries

async function connectWithRetry(peerId, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = peer.connect(peerId, { reliable: true });
      await new Promise((resolve, reject) => {
        conn.on('open', resolve);
        setTimeout(() => reject(new Error('timeout')), RETRY_TIMEOUT);
      });
      return conn;
    } catch (e) {
      await sleep(RETRY_DELAY);
    }
  }
  throw new Error(`Failed to connect after ${retries} retries`);
}
```

---

## Data Format

### Per-Tick State Broadcast (20 Hz from host)

```typescript
interface CarState {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  raceProgress: {
    gateIndex: number;
    distanceToNextGate: number;
  };
  playerColor: string;
  playerName: string;
  speed: number;
}

// Serialization (from Racez.io)
function serializeState(state: CarState): string {
  return JSON.stringify({
    px: state.position.x.toFixed(2),
    py: state.position.y.toFixed(2),
    pz: state.position.z.toFixed(2),
    qx: state.quaternion.x.toFixed(4),
    qy: state.quaternion.y.toFixed(4),
    qz: state.quaternion.z.toFixed(4),
    qw: state.quaternion.w.toFixed(4),
    gi: state.raceProgress.gateIndex,
    dn: state.raceProgress.distanceToNextGate.toFixed(2),
    c: state.playerColor,
    n: state.playerName,
    s: state.speed.toFixed(1),
  });
}
```

### NaN Protection (from Racez.io)

```javascript
// Before sending, validate all numbers
function sanitizeNumber(n: number): number {
  return isFinite(n) ? n : 0;
}
```

### Event Messages

```typescript
// Host → Clients
type HostEvent =
  | { type: 'countdown'; seconds: number }
  | { type: 'raceStart' }
  | { type: 'raceEnd'; results: Array<{ name: string; time: number }> }
  | { type: 'playerJoined'; name: string; color: string }
  | { type: 'playerLeft'; peerId: string }
  | { type: 'state'; players: Record<string, CarState> };

// Client → Host
type ClientEvent =
  | { type: 'state'; state: CarState }
  | { type: 'ready' }
  | { type: 'chat'; message: string };
```

---

## Party Code System

### Express API

```typescript
// POST /api/party/create
// Response: { code: string, peerId: string }
app.post('/api/party/create', (req, res) => {
  const code = generateCode(); // 4-6 char alphanumeric
  const hostPeerId = req.body.peerId;
  parties.set(code, {
    hostPeerId,
    players: [{ peerId: hostPeerId, name: req.body.name }],
    createdAt: Date.now(),
  });
  res.json({ code, peerId: hostPeerId });
});

// POST /api/party/join
// Body: { code: string, peerId: string, name: string }
// Response: { players: Array, hostPeerId: string }
app.post('/api/party/join', (req, res) => {
  const party = parties.get(req.body.code);
  party.players.push({ peerId: req.body.peerId, name: req.body.name });
  res.json({ players: party.players, hostPeerId: party.hostPeerId });
});

// GET /api/party/:code
// Response: { players: Array, hostPeerId: string }
app.get('/api/party/:code', (req, res) => {
  const party = parties.get(req.params.code);
  res.json({ players: party.players, hostPeerId: party.hostPeerId });
});
```

### In-Memory Storage (for jam)

For a 1-week jam, use in-memory `Map`. No database needed.
Add expiry: clean up parties older than 1 hour.

---

## Client-Side Interpolation

To smooth remote player movement:

```typescript
class RemotePlayer {
  private targetPosition = new THREE.Vector3();
  private targetQuaternion = new THREE.Quaternion();
  private interpolationFactor = 0.15; // lerp speed

  update(state: CarState) {
    this.targetPosition.set(state.position.x, state.position.y, state.position.z);
    this.targetQuaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
  }

  render() {
    this.mesh.position.lerp(this.targetPosition, this.interpolationFactor);
    this.mesh.quaternion.slerp(this.targetQuaternion, this.interpolationFactor);
  }
}
```

---

## PeerJS vs WebSocket Comparison

| Factor | PeerJS (WebRTC) | WebSocket Server |
|--------|-----------------|------------------|
| **Latency** | ~30-80ms (P2P) | ~50-150ms (via server) |
| **Server load** | None for game state | All traffic goes through server |
| **Infrastructure** | PeerJS cloud (free) or self-hosted | Need WebSocket server |
| **Max players** | ~6-8 (P2P limits) | Hundreds |
| **NAT traversal** | Built-in (STUN/TURN) | N/A (client connects to server) |
| **Complexity** | Low (simple API) | Medium (need server logic) |
| **Reliability** | Connection can drop | Generally stable |
| **Our use case** | ✅ Perfect (2-4 players, P2P) | Overkill |

**Verdict:** PeerJS is the right choice for 2-4 player P2P racing. Racez.io proves it works in production.

---

## Sources

- `web-racing/frontend/src/modules/multiplayer.js` — Full PeerJS implementation
- `web-racing/backend/party_codes/views.py` — Django party code API (translate to Express)
- Racez.io live: https://racez.io
