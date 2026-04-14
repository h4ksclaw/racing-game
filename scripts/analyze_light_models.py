import os, struct, json

base = "public/assets/kenney-racing-kit"
models = [
    "lightPostModern",
    "lightPost_exclusive", 
    "lightColored",
    "lightRed",
    "lightPostLarge",
    "lightRedDouble",
]

for model in models:
    obj_path = f"{base}/Models/OBJ format/{model}.obj"
    glb_path = f"{base}/Models/GLTF format/{model}.glb"
    
    print(f"\n=== {model} ===")
    
    # Parse OBJ for bounds and center
    verts = []
    with open(obj_path) as f:
        for line in f:
            if line.startswith("v "):
                parts = line.split()
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
    
    if not verts:
        print("  No vertices!")
        continue
    
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    
    print(f"  Vertices: {len(verts)}")
    print(f"  X range: [{min(xs):.4f}, {max(xs):.4f}]  center: {(min(xs)+max(xs))/2:.4f}")
    print(f"  Y range: [{min(ys):.4f}, {max(ys):.4f}]  center: {(min(ys)+max(ys))/2:.4f}")
    print(f"  Z range: [{min(zs):.4f}, {max(zs):.4f}]  center: {(min(zs)+max(zs))/2:.4f}")
    print(f"  Bounding box size: {max(xs)-min(xs):.4f} x {max(ys)-min(ys):.4f} x {max(zs)-min(zs):.4f}")
    
    # Find the top cluster of vertices (likely the light fixture)
    top_thresh = max(ys) * 0.85
    top_verts = [(x,y,z) for x,y,z in verts if y >= top_thresh]
    if top_verts:
        txs = [v[0] for v in top_verts]
        tzs = [v[2] for v in top_verts]
        print(f"  Light fixture (top 15%): {len(top_verts)} verts")
        print(f"    X range: [{min(txs):.4f}, {max(txs):.4f}]")
        print(f"    Z range: [{min(tzs):.4f}, {max(tzs):.4f}]")
        print(f"    Center XZ: ({(min(txs)+max(txs))/2:.4f}, {(min(tzs)+max(tzs))/2:.4f})")
    
    # Find the bottom cluster (base)
    bot_thresh = min(ys) + (max(ys) - min(ys)) * 0.15
    bot_verts = [(x,y,z) for x,y,z in verts if y <= bot_thresh]
    if bot_verts:
        bxs = [v[0] for v in bot_verts]
        bzs = [v[2] for v in bot_verts]
        print(f"  Base (bottom 15%): {len(bot_verts)} verts")
        print(f"    X range: [{min(bxs):.4f}, {max(bxs):.4f}]")
        print(f"    Z range: [{min(bzs):.4f}, {max(bzs):.4f}]")
        print(f"    Center XZ: ({(min(bxs)+max(bxs))/2:.4f}, {(min(bzs)+max(bzs))/2:.4f})")
    
    # Check model file size
    glb_size = os.path.getsize(glb_path)
    print(f"  GLB size: {glb_size} bytes")

    # Determine where the model center is relative to the post
    cx = (min(xs) + max(xs)) / 2
    cz = (min(zs) + max(zs)) / 2
    print(f"  OFFSET from origin to center: ({cx:.4f}, 0, {cz:.4f})")
    print(f"  → Need to offset by (-{cx:.4f}, -{min(ys):.4f}, -{cz:.4f}) to center base at origin")
