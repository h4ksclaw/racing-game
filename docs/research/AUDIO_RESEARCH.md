# Audio Research — Engine Sound Synthesis & SFX

## Approach: Procedural Engine Sound + Static SFX

### Engine Sound Synthesis

Three tiers of complexity:

#### Tier 1: Simple Oscillator (trivial, sounds synthetic)
- Single oscillator with frequency mapped to RPM
- ~20 lines of code
- Sounds like a synthesizer, not a car
- Good enough for a jam prototype

#### Tier 2: Multi-Oscillator Harmonics + Noise (recommended)
- Base oscillator + harmonic overtones + noise layer
- ~100 lines of code
- Decent sound quality
- RPM maps to: base frequency, filter cutoff, noise volume
- Pattern: fundamental (50-200Hz) + 2nd harmonic + 3rd harmonic + filtered noise

```typescript
// Pseudocode pattern
osc1 = Oscillator(fundamental * 1.0)   // base
osc2 = Oscillator(fundamental * 2.0)   // 2nd harmonic
osc3 = Oscillator(fundamental * 0.5)   // sub bass
noise = WhiteNoise → BandpassFilter(rpm-dependent) → Gain
gain = GainNode mapped to throttle position
```

#### Tier 3: AudioWorklet Waveguide Synthesis (most realistic)
- Physical waveguide models for intake, cylinders, exhaust, muffler
- Most realistic, most complex
- **Reference:** [Antonio-R1/engine-sound-generator](https://github.com/Antonio-R1/engine-sound-generator) (MIT)
- Uses AudioWorklet with separate waveguide for each engine component
- Best for post-jam polish

### driftking's Approach (Tone.js)

From reading `driftking/game/Sound.ts`:
- **Engine:** `BrownNoise` → filter → gain, pitch scales with car speed
- **Tire skid:** `WhiteNoise` → triggered on drift start, released on end
- **Music:** `PolySynth` FM square with simple pattern
- **Library:** Tone.js (https://tonejs.github.io/)
- ~80 lines total

### Recommended Implementation

Start with **Tier 2** (multi-oscillator harmonics). If time permits, swap to the Antonio-R1 AudioWorklet approach.

Key parameters to map:
- `RPM` → oscillator frequency (50-300Hz range)
- `RPM` → filter cutoff (higher RPM = brighter sound)
- `throttle` → gain (louder when accelerating)
- `speed` → subtle pitch modulation
- `gear shift` → brief volume dip + frequency reset

## Static SFX

### What's Needed
| Sound | Use Case |
|-------|----------|
| Tire skid/screech | Drifting |
| Car crash/impact | Collisions |
| Countdown beep | Race start (3-2-1-GO) |
| Crowd cheer | Race finish |
| Horn/honk | Fun interaction |

### Sources (all free, no login)

**Pixabay** — https://pixabay.com/sound-effects/
- Best source: no login, commercial OK, CC0/CC-BY
- Cloudflare blocks automated downloads — manual download required
- Search terms: "tire skid", "car crash", "countdown beep", "crowd cheer", "car horn"

**Freesound** — https://freesound.org
- Largest library, but requires free account
- Some files are CC0, some require attribution
- Better quality than Pixabay

**OpenGameArt** — https://opengameart.org/art-search-advanced?keys=&field_art_type%5B%5D=9
- Game-focused, CC0/CC-BY
- Less car-specific sounds

### Manual Download Steps

1. Go to https://pixabay.com/sound-effects/
2. Search for each sound above
3. Download MP3 or WAV
4. Place in `public/audio/`
5. Reference in `AudioManager.ts` as `new Audio('/audio/filename.mp3')`

## Code Pattern for AudioManager

```typescript
class AudioManager {
  private engineOsc: OscillatorNode;
  private engineGain: GainNode;
  private engineFilter: BiquadFilterNode;
  private context: AudioContext;

  constructor() {
    this.context = new AudioContext();
    // Setup oscillator chain
    this.engineOsc = this.context.createOscillator();
    this.engineFilter = this.context.createBiquadFilter();
    this.engineGain = this.context.createGain();
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.context.destination);
    this.engineOsc.start();
  }

  updateEngine(rpm: number, throttle: number): void {
    const freq = 50 + (rpm / 8000) * 250;
    this.engineOsc.frequency.setValueAtTime(freq, this.context.currentTime);
    this.engineFilter.frequency.setValueAtTime(200 + rpm * 0.5, this.context.currentTime);
    this.engineGain.gain.setValueAtTime(0.1 + throttle * 0.3, this.context.currentTime);
  }

  playSFX(name: string): void {
    const audio = new Audio(`/audio/${name}.mp3`);
    audio.play();
  }
}
```

## Sources

- [Antonio-R1/engine-sound-generator](https://github.com/Antonio-R1/engine-sound-generator) — MIT, AudioWorklet waveguide
- [Tone.js](https://tonejs.github.io/) — Audio synthesis library (used by driftking)
- [driftking/game/Sound.ts](https://github.com/harked/driftking/blob/main/game/Sound.ts) — Reference implementation
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — MDN docs
- [Pixabay Sound Effects](https://pixabay.com/sound-effects/) — Free SFX, no login
- [Freesound](https://freesound.org) — Large SFX library, free account
