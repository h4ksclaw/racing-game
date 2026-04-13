#!/usr/bin/env python3
import sys

content = open(sys.argv[1]).read()

old = "\tconst numPoints = opts.numPoints ?? 14;\n\tconst tightness = opts.tightness ?? 5;\n\tconst elevationAmp = opts.elevation ?? 40;\n\tconst downhillBias = (opts.downhillBias ?? 60) / 100;\n\tconst width = opts.width ?? 12;\n\tconst shoulderWidth = opts.shoulderWidth ?? 2;\n\tconst kerbWidth = opts.kerbWidth ?? 0.8;\n\tconst minSamples = opts.minSamples ?? 500;\n\n\t// ── 2-D control points ────────────────────────────────────────────────\n\tconst baseRadius = 350 + (10 - tightness) * 50;\n\tconst cp2d: V3[] = [];\n\tfor (let i = 0; i < numPoints; i++) {\n\t\tconst baseAngle = (i / numPoints) * Math.PI * 2;\n\t\tconst rj = (rng() * 2 - 1) * baseRadius * 0.35;\n\t\tconst aj = (rng() * 2 - 1) * ((Math.PI * 2) / numPoints) * 0.4;\n\t\tconst r = baseRadius + rj;\n\t\tconst a = baseAngle + aj;\n\t\tcp2d.push(v3(Math.cos(a) * r, 0, Math.sin(a) * r));\n\t}\n\n\t// Chaikin smoothing ×2\n\tfor (let pass = 0; pass < 2; pass++) {\n\t\tconst smoothed: V3[] = [];\n\t\tfor (let i = 0; i < numPoints; i++) {\n\t\t\tconst prev = cp2d[(i - 1 + numPoints) % numPoints];\n\t\t\tconst cur = cp2d[i];\n\t\t\tconst next = cp2d[(i + 1) % numPoints];\n\t\tsmoothed.push(\n\t\t\t\tv3(cur.x * 0.6 + (prev.x + next.x) * 0.2, 0, cur.z * 0.6 + (prev.z + next.z) * 0.2),\n\t\t\t);\n\t\t}\n\t\tfor (let i = 0; i < numPoints; i++) cp2d[i] = smoothed[i];\n\t}"

assert old in content, "Old text not found!"

new = """\tconst numPoints = opts.numPoints ?? 14;
\tconst tightness = opts.tightness ?? 5;
\tconst elevationAmp = opts.elevation ?? 80;
\tconst downhillBias = (opts.downhillBias ?? 70) / 100;
\tconst width = opts.width ?? 12;
\tconst shoulderWidth = opts.shoulderWidth ?? 2;
\tconst kerbWidth = opts.kerbWidth ?? 0.8;
\tconst minSamples = opts.minSamples ?? 500;

\t// ── Segment-based 2-D control points ────────────────────────────────
\ttype SegmentType = "straight" | "sweeper" | "hairpin" | "chicane" | "s-curve" | "decreasing";

\tinterface Segment {
\t\ttype: SegmentType;
\t\tlength: number;
\t\tangle: number;
\t}

\tfunction randomSegment(): Segment {
\t\tconst roll = rng();
\t\tif (roll < 0.15) {
\t\t\treturn { type: "straight", length: 60 + rng() * 120, angle: 0 };
\t\t}
\t\tif (roll < 0.40) {
\t\t\treturn {
\t\t\t\ttype: "sweeper",
\t\t\t\tlength: 40 + rng() * 80,
\t\t\t\tangle: (0.5 + rng() * 1.0) * (rng() < 0.5 ? 1 : -1),
\t\t\t};
\t\t}
\t\tif (roll < 0.55) {
\t\t\treturn {
\t\t\t\ttype: "hairpin",
\t\t\t\tlength: 25 + rng() * 20,
\t\t\t\tangle: (2.6 + rng() * 0.5) * (rng() < 0.5 ? 1 : -1),
\t\t\t};
\t\t}
\t\tif (roll < 0.70) {
\t\t\tconst dir = rng() < 0.5 ? 1 : -1;
\t\t\tconst a1 = (0.4 + rng() * 0.4) * dir;
\t\t\tconst a2 = (0.8 + rng() * 0.4) * -dir;
\t\t\tconst a3 = (0.3 + rng() * 0.3) * dir;
\t\t\treturn {
\t\t\t\ttype: "chicane",
\t\t\t\tlength: 15 + rng() * 15,
\t\t\t\tangle: a1 + a2 + a3,
\t\t\t};
\t\t}
\t\tif (roll < 0.85) {
\t\t\tconst dir = rng() < 0.5 ? 1 : -1;
\t\t\tconst n = 2 + Math.floor(rng() * 2);
\t\t\tlet totalAngle = 0;
\t\t\tfor (let s = 0; s < n; s++) {
\t\t\t\ttotalAngle += (0.4 + rng() * 0.6) * (s % 2 === 0 ? dir : -dir);
\t\t\t}
\t\t\treturn {
\t\t\t\ttype: "s-curve",
\t\t\t\tlength: 50 + rng() * 60,
\t\t\t\tangle: totalAngle,
\t\t\t};
\t\t}
\t\treturn {
\t\t\ttype: "decreasing",
\t\t\tlength: 35 + rng() * 40,
\t\t\tangle: (0.8 + rng() * 0.8) * (rng() < 0.5 ? 1 : -1),
\t\t};
\t}

\t// Generate 8-14 segments
\tconst numSegments = 8 + Math.floor(rng() * 7);
\tconst segments: Segment[] = [];
\tlet hadStraight = false;
\tfor (let s = 0; s < numSegments; s++) {
\t\tconst seg = randomSegment();
\t\tsegments.push(seg);
\t\tif (seg.type === "straight") hadStraight = true;
\t}
\tif (!hadStraight) segments[Math.floor(rng() * numSegments)] = { type: "straight", length: 80 + rng() * 80, angle: 0 };

\t// Walk the path from segments to build control points
\tconst cp2d: V3[] = [];
\tlet heading = 0;
\tlet px = 0;
\tlet pz = 0;
\tconst step = 8;

\tfor (const seg of segments) {
\t\tconst numSteps = Math.max(2, Math.round(seg.length / step));
\t\tconst anglePerStep = seg.angle / numSteps;
\t\tfor (let s = 0; s < numSteps; s++) {
\t\t\tcp2d.push(v3(px, 0, pz));
\t\t\tlet angleInc = anglePerStep;
\t\t\tif (seg.type === "decreasing") {
\t\t\t\tangleInc = anglePerStep * (1 + (s / numSteps) * 0.8);
\t\t\t}
\t\t\theading += angleInc;
\t\t\tpx += Math.sin(heading) * step;
\t\t\tpz += Math.cos(heading) * step;
\t\t}
\t}

\t// Close the loop
\tconst closeDx = -px;
\tconst closeDz = -pz;
\tconst closeDist = Math.sqrt(closeDx * closeDx + closeDz * closeDz);
\tconst closeAngle = Math.atan2(closeDx, closeDz);
\tconst normAngle = Math.atan2(Math.sin(closeAngle - heading), Math.cos(closeAngle - heading));
\tconst closeSteps = Math.max(3, Math.round(closeDist / step));
\tconst closeAnglePerStep = normAngle / closeSteps;
\tfor (let s = 0; s < closeSteps; s++) {
\t\tcp2d.push(v3(px, 0, pz));
\t\theading += closeAnglePerStep;
\t\tpx += Math.sin(heading) * step;
\t\tpz += Math.cos(heading) * step;
\t}

\t// Center around origin
\tlet cx = 0;
\tlet cz = 0;
\tfor (const p of cp2d) {
\t\tcx += p.x;
\t\tcz += p.z;
\t}
\tcx /= cp2d.length;
\tcz /= cp2d.length;
\tfor (const p of cp2d) {
\t\tp.x -= cx;
\t\tp.z -= cz;
\t}"""

content = content.replace(old, new)
open(sys.argv[1], 'w').write(content)
print('Done')
