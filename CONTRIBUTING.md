# Contributing — How to Work on This Project

## Quick Start

```bash
npm install          # install dependencies
npm run dev          # start dev server on localhost:3000
npm run check        # typecheck + lint (do this before pushing)
npm run fix          # auto-fix all lint + format issues
```

## Development Workflow

1. **Pull latest** — `git pull`
2. **Create a branch** — `git checkout -b feature/my-thing`
3. **Code** — make your changes
4. **Run `npm run fix`** — auto-fixes linting/formatting
5. **Run `npm run check`** — verify TypeScript + Biome pass
6. **Commit** — pre-commit hook runs biome auto-fix + tsc automatically
7. **Push** — GitHub Actions runs full CI (typecheck + biome + build + docker)

## Pre-commit Hooks

Husky runs automatically on `git commit`:
- `lint-staged` — runs `biome check --write` on staged `.ts` files
- `tsc --noEmit` — blocks commit if TypeScript has errors

Bad TypeScript? Commit is **blocked**.
Bad formatting? Auto-**fixed** before commit.

## Scripts

| Command | What It Does |
|---------|-------------|
| `npm run dev` | Vite dev server with hot reload (localhost:3000) |
| `npm run build` | TypeCheck + Vite production build → `dist/` |
| `npm run lint` | Biome check only (fails on errors) |
| `npm run lint:fix` | Biome check + auto-fix |
| `npm run typecheck` | TypeScript strict check only |
| `npm run check` | TypeCheck + Biome (CI equivalent locally) |
| `npm run fix` | Biome auto-fix + TypeCheck (run this before committing) |

## Code Style

All enforced by Biome (zero config needed):
- **Tabs** for indentation
- **Double quotes** for strings
- **Semicolons** required
- **100 char** line width
- **No unused variables** (TypeScript strict)
- **No explicit `any`** (warned)
- **No forEach** (warned — use for-of instead)

## Project Structure

```
src/
├── client/          # Browser code
│   ├── main.ts      # Entry point
│   ├── game/        # Game loop, physics, scene, input
│   ├── vehicle/     # Car physics, controls, camera
│   ├── track/       # Track loading & generation
│   ├── multiplayer/ # PeerJS networking
│   ├── audio/       # Sound engine
│   ├── effects/     # Particles, skid marks, post-processing
│   ├── ui/          # HUD, lobby, leaderboard
│   └── utils/       # Math helpers
├── server/          # Express lobby server
└── shared/          # Types and constants (used by both client & server)
```

## Adding a New Feature

1. **Define types** in `src/shared/types.ts` if they're shared across modules
2. **Add constants** in `src/shared/constants.ts` for tunable values
3. **Write the class** in the appropriate `src/client/` subdirectory
4. **Wire it into `Game.ts`** — add as a property, init in constructor, update in loop
5. **Run `npm run fix`** — auto-fix formatting
6. **Run `npm run check`** — verify everything passes

## Research & Docs

Start with `docs/AIDOCS.md` — it's the master reference. Key docs:
- `docs/architecture.md` — system diagram, data flow, game loop
- `docs/research/PHYSICS_RESEARCH.md` — drift mechanics, cannon-es patterns
- `docs/research/NETWORKING_RESEARCH.md` — PeerJS host-relay pattern
- `docs/research/ENGINE_COMPARISON.md` — why Three.js
- `docs/research/AUDIO_RESEARCH.md` — engine sound synthesis
- `docs/assets/INDEX.md` — complete asset inventory

## Development Phases

See `docs/AIDOCS.md` → "Development Roadmap" for the full plan.

**Phase 1 (start here):** Get a car driving — Vehicle + VehicleControls + InputManager
**Phase 2:** Drift mechanics — frictionSlip, drift detection, scoring
**Phase 3:** Track & race — checkpoints, laps, multiple tracks
**Phase 4:** Multiplayer — PeerJS, lobby, state sync
**Phase 5:** Polish — effects, sound, deploy
