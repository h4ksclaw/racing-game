# 3D Model Generation Research for Racing Game

**Date:** 2026-04-16  
**Goal:** Find tools/services to create textured 3D car models from images or text  
**Constraint:** No GPU (2 CPU cores, 3.8GB RAM VM)

---

## 1. Hunyuan3D 2.1 (Tencent)

**What it does:** State-of-the-art image-to-3D pipeline with PBR textures. Two-stage: shape generation (3.3B params) → texture painting (2B params). First production-ready open-source 3D asset generation model.

**GPU Requirements:** 10GB for shape only, 21GB for texture only, **29GB total** — completely out of reach for us.

**Hosted HuggingFace Space:** Available at:
- https://huggingface.co/spaces/Jbowyer/Hunyuan3D-2.1 (L40S GPU)
- https://huggingface.co/spaces/tencent/Hunyuan3D-2.1 (official)

These are **free to use** but subject to queue times and rate limits. You upload an image and download the result. No API key needed — just use the Gradio web UI.

**Output format:** OBJ mesh with PBR texture maps (metallic, roughness, normal, albedo). Would need conversion to GLB via Blender or gltf-pipeline.

**Quality for cars:** Among the best available. Benchmarks show it surpasses TRELLIS, TripoSG, Craftsman, and others in texture and shape quality. PBR textures are a big win for game engines.

**License:** Apache 2.0 for the model itself. Generated outputs are yours.

**Can we automate?** Not directly — no public API. Would need browser automation to interact with the Gradio Space, which is fragile. Could be done manually for one-off model creation.

---

## 2. Meshy.ai

**Free tier:** 100 credits/month (~10 assets), 1 concurrent task, low priority queue, CC BY 4.0 license (non-commercial). No API access on free tier.

**Features:** Image-to-3D, text-to-3D, AI texturing, remesh, rigging & animation. Full feature set on free tier (just limited credits).

**Output format:** GLB (primary), FBX, OBJ, USDZ — excellent compatibility.

**Quality:** Very good for general objects. Cars are reasonable but may lack fine details. AI texturing helps significantly.

**License:** Free tier = CC BY 4.0 (must credit, non-commercial only). Pro ($20/mo) = private/commercial license.

**API:** RESTful API available on Pro+ plans only. Predictable resource-oriented URLs, JSON responses. Not available on free tier.

**Cost for commercial:** Pro at $20/mo gives 1000 credits (100 assets), private license, API access.

**Verdict:** Best overall option if we pay for Pro. Free tier is too limited for a game (CC BY 4.0 = must credit + non-commercial).

---

## 3. TripoAI (Tripo Studio)

**Free tier (Basic):** 300 credits/month, 1 concurrent task, 20 models stored, limited downloads, public models under **CC BY 4.0**. 1 trial generation with v3.0 Ultra.

**Features:** Image-to-3D, text-to-3D, multi-view, batch generation, smart low-poly, part segmentation, skeleton export.

**Output format:** GLB, FBX, OBJ, USDZ, STL.

**Quality:** Tripo v3.0 Ultra is competitive. Good for vehicles.

**License:** Free = CC BY 4.0. Professional ($11.94/mo annual) = commercial license.

**API:** Available, but likely paid-tier only (similar to Meshy).

**Verdict:** Good free tier (300 credits > Meshy's 100), but same CC BY 4.0 limitation. Professional tier is cheaper than Meshy.

---

## 4. Luma AI (Genie)

**Status:** Luma has pivoted to video/image generation (Dream Machine, unified UNI-1 model). Genie (3D generation) appears to be deprecated or rebranded. The main site no longer prominently features 3D generation.

**Verdict:** Not a viable option currently. Skip.

---

## 5. CSM.ai

**Status:** Site appears to be down or rebranded (DNS failure). Was previously a 3D generation service.

**Verdict:** Unavailable. Skip.

---

## 6. TRELLIS (Microsoft)

**What it does:** Large-scale 3D generation (up to 2B params). Text or image → meshes, gaussians, radiance fields. Supports local 3D editing.

**GPU Requirements:** Minimum 16GB VRAM (tested on A100/A6000). Cannot run locally.

**Hosted Space:** https://huggingface.co/spaces/trellis-community/TRELLIS — free to use via Gradio UI.

**Output format:** Can export as mesh (GLB-compatible), 3D Gaussians, radiance fields.

**Quality:** Excellent — CVPR 2025 Spotlight. Surpasses many prior methods. Microsoft recommends image-conditioned over text-conditioned for better results.

**License:** MIT license on the code. Generated assets are yours.

**Automation:** No public API for the hosted space. Same browser automation limitation as Hunyuan3D.

---

## 7. Other Open-Source (TripoSR, OpenLRM, Stable Fast 3D, Rodin)

All require GPU and cannot run on our VM:
- **TripoSR:** ~8GB VRAM minimum — still needs GPU
- **OpenLRM:** Needs GPU with significant VRAM
- **Stable Fast 3D:** Requires NVIDIA GPU
- **Rodin (OctoAI):** Cloud service, may have pricing changes

**Verdict:** All require GPU. Skip for local deployment.

---

## Comparison Table

| Tool | Free Credits | GLB Output | License | API | Car Quality | No-GPU Viable |
|------|-------------|------------|---------|-----|-------------|---------------|
| **Meshy Free** | 100/mo (~10) | ✅ | CC BY 4.0 ❌ | ❌ | Good | ✅ |
| **Meshy Pro** | 1000/mo (~100) | ✅ | Commercial ✅ | ✅ | Good | ✅ |
| **Tripo Free** | 300/mo | ✅ | CC BY 4.0 ❌ | ❌ | Good | ✅ |
| **Tripo Pro** | 3000/mo | ✅ | Commercial ✅ | ✅ | Very Good | ✅ |
| **Hunyuan3D** | Unlimited (HF) | OBJ→GLB | Apache 2.0 ✅ | ❌ | Best | ✅ (manual) |
| **TRELLIS** | Unlimited (HF) | ✅ | MIT ✅ | ❌ | Excellent | ✅ (manual) |
| **Luma Genie** | N/A | — | — | — | — | ❌ deprecated |

---

## Recommendation

### Best approach given no GPU:

**Tier 1 — Manual generation via hosted Spaces (free, best quality):**
1. **Hunyuan3D 2.1** via HuggingFace Space for PBR-textured car models. Upload reference car images → download OBJ → convert to GLB. Best texture quality, Apache 2.0 license, free.
2. **TRELLIS** via HuggingFace Space as backup. Slightly easier workflow, MIT license.

**Tier 2 — Automated via paid API (best for scale):**
1. **Tripo Pro** ($11.94/mo annual) — cheapest commercial option with API access, GLB output, 3000 credits/month.
2. **Meshy Pro** ($20/mo) — more features but pricier.

### Practical workflow for our game:
1. Use **Hunyuan3D HuggingFace Space** to manually generate initial car models (free, best PBR quality)
2. If we need more models or automation later, subscribe to **Tripo Pro** for API access
3. Convert all outputs to GLB for Three.js compatibility
4. Consider post-processing (simplify geometry, optimize textures) since AI-generated models tend to be high-poly

### For a small indie racing game:
- We probably only need 5-15 car models
- Hunyuan3D free Space is sufficient for this volume
- Manual workflow is fine — we're not mass-producing assets
- Budget: $0 if using free Spaces, ~$12/mo if API automation needed
