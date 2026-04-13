import sys

content = open(sys.argv[1]).read()

old = '''async function loadDecorations(): Promise<void> {
\tif (decorationsLoaded) return;
\tdecorationsLoaded = true;

\treturn new Promise((resolve, _reject) => {
\t\tconst loader = new GLTFLoader();
\t\tloader.load(
\t\t\t"/models/maps/map1/decorations.glb",
\t\t\t(gltf) => {
\t\t\t\tgltf.scene.traverse((node) => {
\t\t\t\t\tif (!node.name || !(node instanceof THREE.Object3D)) return;
\t\t\t\t\t// Strip numeric suffixes: "rock_tallH.002" → "rock_tallH"
\t\t\t\t\tconst baseName = node.name.replace(/\\.\\d+$/, "");
\t\t\t\t\tif (!decorationCache.has(baseName)) {
\t\t\t\t\t\tconst clone = node.clone() as THREE.Group;
\t\t\t\t\t\tclone.name = baseName;
\t\t\t\t\t\tdecorationCache.set(baseName, clone);
\t\t\t\t\t}
\t\t\t\t});
\t\t\t\tconsole.log(`Loaded ${decorationCache.size} decoration models`);
\t\t\t\tresolve();
\t\t\t},
\t\t\tundefined,
\t\t\t(error) => {
\t\t\t\tconsole.error("Failed to load decorations.glb:", error);
\t\t\t\tresolve(); // Don't block, fall back to procedural
\t\t\t},
\t\t);
\t});
}'''

new = '''async function loadDecorations(): Promise<void> {
\tif (decorationsLoaded) return;
\tdecorationsLoaded = true;

\tconst loader = new GLTFLoader();
\tlet pending = 2;
\tconst done = () => {
\t\tif (--pending === 0) {
\t\t\tconsole.log(`Loaded ${decorationCache.size} decoration models`);
\t\t\tresolveAll();
\t\t}
\t};
\tlet resolveAll: () => void;
\tconst promise = new Promise<void>((r) => { resolveAll = r; });

\tfunction loadGLB(url: string) {
\t\tloader.load(
\t\t\turl,
\t\t\t(gltf) => {
\t\t\t\tgltf.scene.traverse((node) => {
\t\t\t\t\tif (!node.name || !(node instanceof THREE.Object3D)) return;
\t\t\t\t\tconst baseName = node.name.replace(/\\.\\d+$/, "");
\t\t\t\t\tif (!decorationCache.has(baseName)) {
\t\t\t\t\t\tconst clone = node.clone() as THREE.Group;
\t\t\t\t\t\tclone.name = baseName;
\t\t\t\t\t\tdecorationCache.set(baseName, clone);
\t\t\t\t\t}
\t\t\t\t});
\t\t\t\tdone();
\t\t\t},
\t\t\tundefined,
\t\t\t(error) => {
\t\t\t\tconsole.error(`Failed to load ${url}:`, error);
\t\t\t\tdone();
\t\t\t},
\t\t);
\t}

\tloadGLB("/models/maps/map1/decorations.glb");
\tloadGLB("/models/maps/map1/gates.glb");

\treturn promise;
}'''

assert old in content, "loadDecorations not found!"
content = content.replace(old, new)
open(sys.argv[1], 'w').write(content)
print('Done')
