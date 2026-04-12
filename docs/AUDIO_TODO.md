# Audio — TODO

## Status: POSTPONED

Audio is deferred to post-Phase 1. The core game (driving, physics, networking) works without sound.

## What's Missing

### 1. Procedural Engine Sound (Priority: High)
Generate engine sound dynamically based on RPM — no audio file needed.

**Recommended approach:** Tier 2 multi-oscillator harmonics
- Base oscillator + 2nd harmonic + noise layer
- RPM maps to: base frequency (50-300Hz), filter cutoff, noise volume
- Throttle maps to gain
- ~100 lines of code using Web Audio API (no library needed)

**Alternative:** Use Tone.js (heavier dependency, but driftking proves it works)
- driftking uses `BrownNoise` → filter → gain for engine
- `WhiteNoise` → triggered on drift for tire skid
- ~80 lines with Tone.js

**Best reference code:**
- [Antonio-R1/engine-sound-generator](https://github.com/Antonio-R1/engine-sound-generator) — MIT, AudioWorklet waveguide synthesis
- `driftking/game/Sound.ts` — Tone.js implementation (~80 lines)

### 2. Static SFX Files (Priority: Medium)
Download from [pixabay.com/sound-effects/](https://pixabay.com/sound-effects/) (free, no login):

| Sound | Search Term | Save As |
|-------|------------|---------|
| Tire skid | "tire skid" | `public/audio/tire-skid.mp3` |
| Car crash | "car crash" | `public/audio/car-crash.mp3` |
| Countdown beep | "countdown beep" | `public/audio/countdown.mp3` |
| Crowd cheer | "crowd cheer" | `public/audio/crowd-cheer.mp3` |
| Horn | "car horn" | `public/audio/horn.mp3` |

⚠️ Automated download blocked by Cloudflare. Manual download required.

### 3. AudioManager.ts (Priority: Low)
`src/client/audio/AudioManager.ts` exists as a stub. Implementation plan:
1. Create AudioContext on first user interaction (browser requirement)
2. Set up oscillator chain for engine sound
3. Map `vehicle.getSpeed()` to frequency + gain
4. Load static SFX with `new Audio('/audio/...')` 
5. Trigger SFX on events (drift start, collision, countdown)

## Research Docs
- `docs/research/AUDIO_RESEARCH.md` — Full research with code patterns
