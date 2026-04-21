# Sketchfab Gaming Asset Scraping — Research Notes

## How Game Projects Use Sketchfab

Most indie/hobby game devs use Sketchfab as a source of free 3D models. The typical workflow:

1. **Manual search** — browse Sketchfab, filter by license and downloadability
2. **Sketchfab API** — programmatic search + download (what we're doing)
3. **Browser automation** — Selenium/Puppeteer to scrape results (brittle, rate-limited)

The API approach is best: official, stable, and supports filtering by license.

## Filtering CC Car Models

### License Types on Sketchfab

| Slug | Label | Game Use? |
|------|-------|-----------|
| `cc6074949a22c696` | CC Attribution | ✅ Best — free use with credit |
| `ca422578f0cf4e93` | CC BY-SA | ✅ OK — must share-alike |
| `de4ed41255c84a9a` | CC BY-ND | ⚠️ No derivatives — can't modify |
| `688f727ffc384f7d` | CC0 | ✅ Best — no attribution needed |

**Recommendation:** Use CC BY + CC0 only. BY-ND models can't be modified for games.

### API Filtering

```
GET /v3/search?type=models&downloadable=true&license=cc6074949a22c696,688f727ffc384f7d
```

## Size/Quality Tradeoffs for Game-Ready Models

| Size Range | Quality | Faces | Use Case |
|-----------|---------|-------|----------|
| 1-5 MB | Low | 1-5k | Mobile, background props |
| 5-20 MB | Medium | 5-50k | Indie games, good enough |
| 20-50 MB | High | 50-200k | Desktop games, close-up detail |
| 50-100 MB | Very high | 200k+ | Hero assets, overkill for most |
| 100+ MB | Extreme | 500k+ | Usually not game-ready, skip |

**Sweet spot for racing game cars: 5-30 MB, 10-50k faces.**

### Why Most Sketchfab Models Need Work

- **No LODs** — Sketchfab models are display-only, no level-of-detail variants
- **High-poly** — Often 100k+ faces; need retopology for games
- **No UV unwrapping** or bad UVs
- **Wrong scale** — Need to normalize to game units
- **Embedded textures** in GLB — good for simplicity, bad for memory
- **No collision mesh** — Need to generate separately

## Recommended Search Queries

### By Car Type
- `"sports car" low poly` — arcade racers
- `"sedan car" glb` — everyday cars
- `"race car"` — track-focused
- `"jdm car"` — Japanese imports (limited CC selection)
- `"truck car"` — SUV/pickup
- `"police car"` — emergency vehicles
- `"muscle car"` — American classics
- `"drift car"` — tuned/stanced
- `"formula 1"` — open wheel
- `"go kart"` — fun/retro
- `"bus"` or `"van"` — larger vehicles
- `"offroad car"` — rally/truck

### Quality Filters
- Add `"low poly"` for better game-readiness
- Add `"pbr"` for textured models
- Add `"game ready"` (rare but gold when found)

### Tags Worth Trying
- `low-poly`, `game-ready`, `pbr`, `animated`, `vehicle`, `automobile`

## Known Good CC Creators (for Cars)

These creators consistently upload CC-licensed, downloadable car models:

| Creator | Style | Notes |
|---------|-------|-------|
| **quaternius** | Low poly | Great starter packs, CC0 |
| **Kenney** | Low poly | Game-ready, CC0 (kenney.nl) |
| **cgtrader free** | Mixed | Check individual licenses |
| **Poly Pizza** | Stylized | All CC0 but quality varies |

Note: High-quality realistic CC car models are rare on Sketchfab. Most good car models have restrictive licenses. The Sketchfab API `downloadable=true` + CC license filter gives a small but usable set.

## Practical Tips

1. **Batch search** — try many queries, download everything that looks usable
2. **Check vertex count** — filter client-side for <50k faces
3. **Always verify license** — API says one thing, model description might say another
4. **GLB format** — always request GLB (not OBJ/FBX) for Three.js
5. **Attribution tracking** — store full metadata at download time (we do this in `metadata_json`)
6. **Post-processing needed** — expect to decimate, rescale, and add collision meshes
7. **Face count isn't everything** — a well-optimized 10k face model looks better than a sloppy 100k one
