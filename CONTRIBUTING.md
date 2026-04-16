# Contributing — How to Work on This Project

## Quick Start

```bash
npm install          # install dependencies
npm run dev          # start dev server on localhost:3000
npm run check        # typecheck + lint + knip (do this before pushing)
npm run fix          # auto-fix all lint + format issues
```

## Development Workflow

1. **Pull latest** — `git pull`
2. **Create a branch** — `git checkout -b feature/my-thing`
3. **Code** — make your changes
4. **Run `npm run fix`** — auto-fixes linting/formatting
5. **Run `npm run check`** — verify TypeScript + Biome + Knip pass
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
| `npm run dev:server` | Express API server (localhost:3001) |
| `npm run dev:full` | Both servers + Cloudflare tunnel |
| `npm run build` | TypeCheck + Vite production build → `dist/` |
| `npm run lint` | Biome check only (fails on errors) |
| `npm run lint:fix` | Biome check + auto-fix |
| `npm run typecheck` | TypeScript strict check only |
| `npm run test` | Vitest watch mode |
| `npm run test:run` | Vitest single run |
| `npm run check` | TypeCheck + Biome + Knip |
| `npm run fix` | Biome auto-fix + TypeCheck |

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
├── client/              # Browser code
│   ├── scene.ts         # Shared mutable state (singleton)
│   ├── world.ts         # buildWorld() orchestrator
│   ├── track.ts         # Track viewer entry point
│   ├── practice.ts      # Free-roam driving entry point
│   ├── debug-physics.ts # Physics debug page entry point
│   ├── road.ts          # Road mesh generation
│   ├── terrain.ts       # Heightmap terrain (GLSL shader)
│   ├── buildings.ts     # Procedural houses
│   ├── scenery.ts       # Trees, rocks, grass, guardrails, lights
│   ├── sky.ts           # Sky dome, day/night cycle
│   ├── clouds.ts        # Cloud layer
│   ├── weather.ts       # Weather system (rain/snow/fog)
│   ├── effects.ts       # Bloom post-processing
│   ├── utils.ts         # Shared types and utilities
│   ├── procedural-scenery.ts  # Procedural geometry fallbacks
│   ├── biomes.ts        # 6 biome configurations
│   └── vehicle/         # Car physics
│       ├── types.ts     # CarConfig, VehicleState, VehicleInput
│       ├── CarModel.ts  # Engine, Gearbox, Brakes, TireModel, DragModel
│       ├── VehicleController.ts  # Physics + visual integration
│       └── index.ts     # Barrel exports
├── server/
│   └── index.ts         # Express server + track API
└── shared/
    └── track.ts         # Procedural track generation (pure math)
```

## Pages

| URL | Entry Point | Description |
|-----|------------|-------------|
| `/` | `pages/index.html` | Track viewer with flyover camera |
| `/practice.html` | `src/client/practice.ts` | Free-roam driving with HUD |
| `/physics-debug.html` | `src/client/debug-physics.ts` | Physics tuning with gauges/graphs |

## Docs

- `docs/AIDOCS.md` — master reference (architecture, systems, testing, dev commands)
- `docs/research/PHYSICS_RESEARCH.md` — car physics research
- `docs/research/NETWORKING_RESEARCH.md` — multiplayer patterns
- `aidocs/` — detailed design docs (biome system, sky/weather, terrain generation)

## Testing

Tests use Vitest with path aliases (`@shared`, `@client`). Test files live alongside source files as `*.test.ts`.

```bash
npm run test          # watch mode
npm run test:run      # single run (CI)
```

116 tests across 6 files covering: track generation, biome selection/config, road geometry, vehicle physics (lifecycle, gears, forces, stability, edge cases).
