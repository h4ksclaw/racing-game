import sys

content = open(sys.argv[1]).read()

old = """\t\t// Pumpkin patches (clusters)
\t\tif (rng() < 0.05 * sceneryDensity) {
\t\t\tconst side = rng() < 0.5 ? -1 : 1;
\t\t\tconst offset = side === -1 ? s.grassLeft : s.grassRight;
\t\t\tconst basePos = v3Add(offset, v3Scale(s.binormal, side * (4 + rng() * 12)));
\t\t\tconst clusterSize = 2 + Math.floor(rng() * 4);
\t\t\tfor (let c = 0; c < clusterSize; c++) {
\t\t\t\tscenery.push({
\t\t\t\t\ttype: "crop_pumpkin",
\t\t\t\t\tposition: v3Add(basePos, {
\t\t\t\t\t\tx: (rng() - 0.5) * 4,
\t\t\t\t\t\ty: 0,
\t\t\t\t\t\tz: (rng() - 0.5) * 4,
\t\t\t\t\t}),
\t\t\t\t\trotation: rng() * Math.PI * 2,
\t\t\t\t\tscale: 0.6 + rng() * 0.8,
\t\t\t\t});
\t\t\t}
\t\t}"""

new = """\t\t// Pumpkin farms — clusters with ground patch
\t\tif (rng() < 0.08 * sceneryDensity) {
\t\t\tconst side = rng() < 0.5 ? -1 : 1;
\t\t\tconst offset = side === -1 ? s.grassLeft : s.grassRight;
\t\t\tconst basePos = v3Add(offset, v3Scale(s.binormal, side * (4 + rng() * 15)));
\t\t\tscenery.push({
\t\t\t\ttype: "ground_grass",
\t\t\t\tposition: basePos,
\t\t\t\trotation: rng() * Math.PI * 2,
\t\t\t\tscale: 2 + rng() * 1.5,
\t\t\t});
\t\t\tconst clusterSize = 3 + Math.floor(rng() * 5);
\t\t\tfor (let c = 0; c < clusterSize; c++) {
\t\t\t\tscenery.push({
\t\t\t\t\ttype: "crop_pumpkin",
\t\t\t\t\tposition: v3Add(basePos, { x: (rng() - 0.5) * 5, y: 0, z: (rng() - 0.5) * 5 }),
\t\t\t\t\trotation: rng() * Math.PI * 2,
\t\t\t\t\tscale: 0.5 + rng() * 1.0,
\t\t\t\t});
\t\t\t}
\t\t}"""

assert old in content, "Pumpkin section not found!"
content = content.replace(old, new)
open(sys.argv[1], 'w').write(content)
print('Done')
