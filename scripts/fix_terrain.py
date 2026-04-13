import sys

content = open(sys.argv[1]).read()
lines = content.split('\n')

# Find "const group = new THREE.Group();" in buildTerrain (line 528)
# and "return group;" before smoothstep (line ~665)
start = None
end = None
for i, line in enumerate(lines):
    if i > 520 and 'const group = new THREE.Group();' in line and start is None:
        start = i
    if start and i > start and line.strip() == 'return group;':
        end = i + 1
        break

print(f"Replacing lines {start+1} to {end} ({end-start} lines)")

new_block = """\tconst group = new THREE.Group();

\t// ── Generate terrain mesh ────────────────────────────────────────
\tconst worldSize = 2000;
\tconst segments = 200;

\tconst geometry = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
\tgeometry.rotateX(-Math.PI / 2);
\tconst pos = geometry.attributes.position;
\tconst colors = new Float32Array(pos.count * 3);

\tfor (let i = 0; i < pos.count; i++) {
\t\tconst x = pos.getX(i);
\t\tconst z = pos.getZ(i);

\t\tconst terrainY = terrain.getHeight(x, z);
\t\tpos.setY(i, terrainY);

\t\t// Slope-based coloring
\t\tconst { dist } = terrain.nearestRoad(x, z);
\t\tconst height = terrainY;
\t\tconst blend = smoothstep(15, 40, dist);
\t\tconst slope = blend > 0.5 ? Math.abs(terrainY) / 60 : 0;

\t\tlet r: number, g: number, b: number;
\t\tif (slope > 0.4) {
\t\t\tr = 0.45; g = 0.42; b = 0.38;
\t\t} else if (height > 50) {
\t\t\tr = 0.9; g = 0.92; b = 0.95;
\t\t} else if (height > 25) {
\t\t\tr = 0.15; g = 0.35; b = 0.12;
\t\t} else if (dist < 20) {
\t\t\tr = 0.35; g = 0.6; b = 0.25;
\t\t} else {
\t\t\tr = 0.28; g = 0.52; b = 0.2;
\t\t}

\t\tconst colorNoise = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.03;
\t\tcolors[i * 3] = r + colorNoise;
\t\tcolors[i * 3 + 1] = g + colorNoise;
\t\tcolors[i * 3 + 2] = b + colorNoise;
\t}

\tgeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
\tgeometry.computeVertexNormals();

\tconst material = new THREE.MeshLambertMaterial({ vertexColors: true });
\tconst mesh = new THREE.Mesh(geometry, material);
\tmesh.receiveShadow = true;
\tgroup.add(mesh);

\treturn group;
"""

lines = lines[:start] + new_block.split('\n') + lines[end:]
open(sys.argv[1], 'w').write('\n'.join(lines))
print('Done')
