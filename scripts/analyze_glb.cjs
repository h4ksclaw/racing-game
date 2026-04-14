const fs = require('fs');

function parseGLB(path) {
  const buf = fs.readFileSync(path);
  // GLB: 12-byte header, then [length(4) + type(4) + data] chunks
  // chunk 0 = JSON: starts at offset 12
  let jsonLen = buf.readUInt32LE(12);    // chunk length
  let jsonType = buf.readUInt32LE(16);   // should be 0x4E4F534A ('JSON')
  let jsonStr = buf.slice(20, 20 + jsonLen).toString('utf8');
  let json;
  try { json = JSON.parse(jsonStr); } catch(e) { console.error('Parse error for', path, e.message); return; }
  
  console.log('=== ' + path + ' ===');
  
  if (json.materials) {
    for (const m of json.materials) {
      const pbr = m.pbrMetallicRoughness || {};
      console.log('Material:', m.name);
      console.log('  baseColor:', JSON.stringify(pbr.baseColorFactor));
      console.log('  metallic:', pbr.metallicFactor);
      console.log('  roughness:', pbr.roughnessFactor);
      console.log('  emissive:', JSON.stringify(m.emissiveFactor));
      console.log('  unlit:', m.extensions?.KHR_materials_unlit ? 'YES' : 'no');
    }
  }
  
  if (json.nodes) {
    for (const n of json.nodes) {
      console.log('Node:', n.name, 'translation:', JSON.stringify(n.translation), 'mesh:', n.mesh);
    }
  }
  
  if (json.meshes) {
    for (const m of json.meshes) {
      for (const p of m.primitives) {
        if (p.material !== undefined && json.materials[p.material]) {
          console.log('Primitive material:', json.materials[p.material].name);
        }
      }
    }
  }
}

const models = [
  'lightPostModern',
  'lightPost_exclusive',
  'lightColored',
  'lightRed',
  'lightPostLarge',
  'lightRedDouble',
];

for (const model of models) {
  parseGLB(`public/assets/kenney-racing-kit/Models/GLTF format/${model}.glb`);
  console.log('');
}
