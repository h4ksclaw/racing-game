# Audio Research — Engine Sound, SFX, Tone.js

> **Note:** This file is a placeholder. Detailed audio research is being created by another agent.
> See `driftking/game/Sound.ts` (~80 lines) for the proven reference implementation.

## Quick Reference

### driftking Audio Pattern

- **Engine:** `BrownNoise` → filter → gain, pitch scales with speed
- **Skid:** `WhiteNoise` → triggered on drift start, released on end
- **Music:** `PolySynth` FM square with simple pattern
- **Library:** Tone.js (https://tonejs.github.io/)

### Key Files

- `driftking/game/Sound.ts` — Complete audio implementation
- `driftking/game/Game.ts` — Audio integration with game state
