#!/usr/bin/env python3
"""
Blender control server v2.
Each command spawns blender --background.
Has proper camera framing and rendering.
"""
import socket
import json
import subprocess
import sys
import os
import threading

SCRIPTS = {}

SCRIPTS["get_scene_info"] = """
import bpy, json
objs = []
for o in bpy.data.objects:
    info = {"name": o.name, "type": o.type, "location": list(o.location)}
    if o.type == 'MESH':
        info["vertices"] = len(o.data.vertices)
        info["faces"] = len(o.data.polygons)
    objs.append(info)
result = {
    "name": bpy.data.filepath or "untitled",
    "object_count": len(bpy.data.objects),
    "objects": objs,
    "materials_count": len(bpy.data.materials),
}
print(json.dumps({"status": "success", "result": result}))
"""

SCRIPTS["load_model"] = """
import bpy, json, sys
path = sys.argv[-1]
# Clear default scene objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
if path.endswith('.glb') or path.endswith('.gltf'):
    bpy.ops.import_scene.gltf(filepath=path)
elif path.endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=path)
elif path.endswith('.obj'):
    bpy.ops.wm.obj_import(filepath=path)
objs = [{"name": o.name, "type": o.type, "vertices": len(o.data.vertices) if o.type=='MESH' else 0} for o in bpy.context.scene.objects]
print(json.dumps({"status": "success", "result": {"loaded": path, "objects": objs, "total_objects": len(objs)}}))
"""

SCRIPTS["render"] = """
import bpy, json, sys, math, mathutils

# Parse args: after -- separator, first is output_path, second is model_path
output_path = "/tmp/blender-render.png"
model_path = None
if '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
else:
    args = sys.argv[-1:]  # fallback: last arg is output_path

if len(args) >= 1:
    output_path = args[0]
if len(args) >= 2:
    model_path = args[1]

# Load model if provided
if model_path:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    if model_path.endswith('.glb') or model_path.endswith('.gltf'):
        bpy.ops.import_scene.gltf(filepath=model_path)
    elif model_path.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=model_path)

scene = bpy.context.scene
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output_path

# Remove default cube if present
for obj in scene.objects:
    if obj.name == 'Cube' and obj.type == 'MESH' and len(obj.data.vertices) == 8:
        bpy.data.objects.remove(obj, do_unlink=True)

# Find bounding box of all mesh objects
meshes = [o for o in scene.objects if o.type == 'MESH']
if not meshes:
    print(json.dumps({"status": "error", "message": "No mesh objects to render"}))
    sys.exit(0)

# Calculate bounding box
min_co = None
max_co = None
for obj in meshes:
    for corner in obj.bound_box:
        world_co = obj.matrix_world @ __import__('mathutils').Vector(corner)
        if min_co is None:
            min_co = __import__('mathutils').Vector(world_co)
            max_co = __import__('mathutils').Vector(world_co)
        else:
            for i in range(3):
                min_co[i] = min(min_co[i], world_co[i])
                max_co[i] = max(max_co[i], world_co[i])

center = (min_co + max_co) / 2
size = (max_co - min_co).length

# Set up camera
cam_data = bpy.data.cameras.new("RenderCam")
cam_obj = bpy.data.objects.new("RenderCam", cam_data)
scene.collection.objects.link(cam_obj)
cam_obj.location = center + __import__('mathutils').Vector((size * 1.2, -size * 1.5, size * 0.8))
cam_obj.data.lens = 50
cam_obj.data.clip_end = 1000

# Point camera at center
direction = center - cam_obj.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam_obj.rotation_euler = rot_quat.to_euler()
scene.camera = cam_obj

# Set up lighting
# Key light (sun)
sun_data = bpy.data.lights.new("KeyLight", 'SUN')
sun_obj = bpy.data.objects.new("KeyLight", sun_data)
sun_obj.location = (center.x + 5, center.y - 5, center.z + 10)
sun_data.energy = 5.0
scene.collection.objects.link(sun_obj)

# Fill light
fill_data = bpy.data.lights.new("FillLight", 'SUN')
fill_obj = bpy.data.objects.new("FillLight", fill_data)
fill_obj.location = (center.x - 5, center.y - 3, center.z + 5)
fill_data.energy = 2.0
scene.collection.objects.link(fill_obj)

# Use EEVEE for speed
if hasattr(bpy.types, 'BLENDER_EEVEE_NEXT'):
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
else:
    scene.render.engine = 'BLENDER_EEVEE'

scene.eevee.taa_samples = 16

# Add a ground plane
bpy.ops.mesh.primitive_plane_add(size=size*4, location=(center.x, center.y, min_co.z - 0.01))
ground = bpy.context.active_object
ground.name = "Ground"
ground_mat = bpy.data.materials.new("GroundMat")
ground_mat.use_nodes = True
bsdf = ground_mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs['Base Color'].default_value = (0.2, 0.2, 0.2, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
ground.data.materials.append(ground_mat)

bpy.ops.render.render(write_still=True)
print(json.dumps({"status": "success", "result": {"path": output_path, "resolution": [1920, 1080], "objects_rendered": len(meshes)}}))
"""

SCRIPTS["export_glb"] = """
import bpy, json, sys
path = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
print(json.dumps({"status": "success", "result": path}))
"""

SCRIPTS["add_physics_markers"] = """
import bpy, json, sys, mathutils

model_path = sys.argv[-1]
# Load model
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
if model_path.endswith('.glb') or model_path.endswith('.gltf'):
    bpy.ops.import_scene.gltf(filepath=model_path)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    print(json.dumps({"status": "error", "message": "No meshes found"}))
    sys.exit(0)

# Calculate bounding box
min_co = None
max_co = None
for obj in meshes:
    for corner in obj.bound_box:
        world_co = obj.matrix_world @ mathutils.Vector(corner)
        if min_co is None:
            min_co = mathutils.Vector(world_co)
            max_co = mathutils.Vector(world_co)
        else:
            for i in range(3):
                min_co[i] = min(min_co[i], world_co[i])
                max_co[i] = max(max_co[i], world_co[i])

center = (min_co + max_co) / 2
dims = max_co - min_co

# Create PhysicsMarker at center of mass
pm = bpy.data.objects.new("PhysicsMarker", None)
pm.empty_display_type = 'SPHERE'
pm.empty_display_size = 0.1
pm.location = center
bpy.context.scene.collection.objects.link(pm)

# Create WheelRig markers
half_w = dims.x * 0.4
half_l = dims.y * 0.38
for name, x, y in [
    ("WheelRig_FL", center.x - half_l, center.y + half_w),
    ("WheelRig_FR", center.x + half_l, center.y + half_w),
    ("WheelRig_RL", center.x - half_l, center.y - half_w),
    ("WheelRig_RR", center.x + half_l, center.y - half_w),
]:
    wr = bpy.data.objects.new(name, None)
    wr.empty_display_type = 'CIRCLE'
    wr.empty_display_size = 0.15
    wr.location = (x, y, min_co.z + dims.z * 0.3)
    bpy.context.scene.collection.objects.link(wr)

print(json.dumps({
    "status": "success",
    "result": {
        "dimensions": {"x": round(dims.x, 4), "y": round(dims.y, 4), "z": round(dims.z, 4)},
        "center": [round(c, 4) for c in center],
        "markers_added": ["PhysicsMarker", "WheelRig_FL", "WheelRig_FR", "WheelRig_RL", "WheelRig_RR"]
    }
}))
"""

SCRIPTS["execute_code"] = """
import json, sys
code = sys.argv[-1]
try:
    exec(code)
    print(json.dumps({"status": "success", "result": "executed"}))
except Exception as e:
    import traceback
    print(json.dumps({"status": "error", "message": str(e), "traceback": traceback.format_exc()}))
"""


def run_blender(script_name, extra_arg=None):
    script = SCRIPTS.get(script_name)
    if not script:
        return {"status": "error", "message": f"Unknown command: {script_name}"}
    
    args = ['blender', '--background', '--python-expr', script]
    if extra_arg:
        # Split on null byte for multi-arg commands
        parts = extra_arg.split('\x00')
        args.extend(['--'] + parts)
    
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=180)
        output = result.stdout.strip()
        for line in reversed(output.split('\n')):
            line = line.strip()
            if line.startswith('{'):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        if result.stderr:
            return {"status": "error", "message": result.stderr[-500:]}
        return {"status": "success", "result": output[-500:]}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Blender timed out (180s)"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class Server:
    def __init__(self, host='127.0.0.1', port=9876):
        self.host = host
        self.port = port
        self.running = False
    
    def start(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(5)
        sock.settimeout(1.0)
        self.running = True
        self.sock = sock
        print(f"Blender control server on {self.host}:{self.port}", flush=True)
        
        while self.running:
            try:
                client, addr = sock.accept()
                threading.Thread(target=self._handle, args=(client,), daemon=True).start()
            except socket.timeout:
                continue
            except OSError:
                break
    
    def _handle(self, client):
        buf = b''
        try:
            while True:
                data = client.recv(65536)
                if not data:
                    break
                buf += data
                try:
                    cmd = json.loads(buf.decode())
                    buf = b''
                    t = cmd.get('type', 'get_scene_info')
                    p = cmd.get('params', {})
                    
                    extra = None
                    if t == 'load_model':
                        extra = p.get('path', '')
                    elif t == 'export_glb':
                        extra = p.get('path', '')
                    elif t == 'add_physics_markers':
                        extra = p.get('path', '')
                    elif t == 'render':
                        mp = p.get('model_path')
                        op = p.get('path', '/tmp/blender-render.png')
                        if mp:
                            # Pass as two separate args
                            # We'll handle splitting in run_blender
                            extra = f"{op}\x00{mp}"
                        else:
                            extra = op
                    elif t == 'execute_code':
                        extra = p.get('code', '')
                    
                    result = run_blender(t, extra)
                    client.sendall(json.dumps(result).encode())
                except json.JSONDecodeError:
                    continue
        finally:
            client.close()
    
    def stop(self):
        self.running = False
        if self.sock:
            self.sock.close()


if __name__ == '__main__':
    s = Server()
    try:
        s.start()
    except KeyboardInterrupt:
        s.stop()
