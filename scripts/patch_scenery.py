with open('src/client/scenery.ts', 'r') as f:
    content = f.read()

old = '''let fallbackBiomeName = "Temperate Forest";

export function setFallbackBiome(biomeName: string): void {
\tfallbackBiomeName = biomeName;
}'''

new = '''let fallbackBiomeName = "Temperate Forest";
let currentLightModel: string | null = null;
const lightModelCache = new Map<string, THREE.Group>();
const LIGHT_MODEL_SCALE = 7; // Kenney models are ~0.7 units → scale to ~5m

export function setFallbackBiome(biomeName: string): void {
\tfallbackBiomeName = biomeName;
}

export function setLightModel(modelPath: string | undefined): void {
\tcurrentLightModel = modelPath ?? null;
}

/** Pre-load light post GLB model */
export function loadLightModel(loader: GLTFLoader, path: string): Promise<void> {
\treturn new Promise((resolve) => {
\t\tif (lightModelCache.has(path)) { resolve(); return; }
\t\tloader.load(path, (gltf) => {
\t\t\tlightModelCache.set(path, gltf.scene.clone());
\t\t\tresolve();
\t\t}, undefined, () => resolve());
\t});
}'''

content = content.replace(old, new)

with open('src/client/scenery.ts', 'w') as f:
    f.write(content)

print("Done")
