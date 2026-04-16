#!/usr/bin/env python3
"""
Add physics markers to a GLB car model using Blender headless.

Usage:
    blender --background --python add-markers.py -- <input.glb> [output.glb]

Adds empty objects:
  - PhysicsMarker   (at bounding box bottom center)
  - WheelRig_FrontLeft, WheelRig_FrontRight
  - WheelRig_RearLeft,  WheelRig_RearRight
"""

import sys
import os

def main():
    argv = sys.argv
    # Blender appends its own args; find "--" separator
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        print("Error: pass args after '--'. Usage: blender --background --python add-markers.py -- input.glb [output.glb]")
        sys.exit(1)

    if len(argv) < 1:
        print("Error: no input file specified")
        sys.exit(1)

    input_path = os.path.abspath(argv[0])
    output_path = os.path.abspath(argv[1]) if len(argv) > 1 else input_path.replace(".glb", "-marked.glb")

    if not os.path.exists(input_path):
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    import bpy

    # Clear default scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    if not hasattr(bpy.ops.import_scene, "gltf"):
        print("Error: glTF importer not available. Blender 4.0+ required.")
        sys.exit(1)

    bpy.ops.import_scene.gltf(filepath=input_path)

    # Collect all mesh objects
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        print("Error: no mesh objects found in file")
        sys.exit(1)

    # Calculate combined bounding box
    from mathutils import Vector
    bbox_min = Vector((float('inf'),) * 3)
    bbox_max = Vector((float('-inf'),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world_co = obj.matrix_world @ Vector(corner)
            bbox_min = Vector([min(a, b) for a, b in zip(bbox_min, world_co)])
            bbox_max = Vector([max(a, b) for a, b in zip(bbox_max, world_co)])

    bbox_center = (bbox_min + bbox_max) / 2
    bbox_size = bbox_max - bbox_min
    print(f"Bounding box: size={tuple(round(v, 4) for v in bbox_size)}, center={tuple(round(v, 4) for v in bbox_center)}")

    # Approximate wheel positions
    length = bbox_size.x
    width = bbox_size.y
    height = bbox_size.z

    # PhysicsMarker at bottom center
    marker_loc = (bbox_center.x, bbox_center.y, bbox_min.z)
    marker = bpy.data.objects.new("PhysicsMarker", None)
    marker.empty_display_type = 'SPHERE'
    marker.empty_display_size = height * 0.05
    marker.location = marker_loc
    bpy.context.collection.objects.link(marker)

    # Wheel positions (relative to bbox)
    # Wheels are roughly at the corners of the bottom face, slightly inset
    wheel_x_offset = length * 0.35  # front/rear offset from center
    wheel_y_offset = width * 0.45   # side offset from center
    wheel_z = bbox_min.z + height * 0.15  # slightly above ground

    wheel_positions = {
        "WheelRig_FrontLeft":  (bbox_center.x + wheel_x_offset, bbox_center.y - wheel_y_offset, wheel_z),
        "WheelRig_FrontRight": (bbox_center.x + wheel_x_offset, bbox_center.y + wheel_y_offset, wheel_z),
        "WheelRig_RearLeft":   (bbox_center.x - wheel_x_offset, bbox_center.y - wheel_y_offset, wheel_z),
        "WheelRig_RearRight":  (bbox_center.x - wheel_x_offset, bbox_center.y + wheel_y_offset, wheel_z),
    }

    for name, pos in wheel_positions.items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = 'CIRCLE'
        empty.empty_display_size = height * 0.08
        empty.location = pos
        bpy.context.collection.objects.link(empty)
        print(f"  Added {name} at {tuple(round(v, 4) for v in pos)}")

    print(f"  Added PhysicsMarker at {tuple(round(v, 4) for v in marker_loc)}")

    # Export to GLB
    if not hasattr(bpy.ops.export_scene, "gltf"):
        print("Error: glTF exporter not available.")
        sys.exit(1)

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_apply=True,
    )
    print(f"Exported to: {output_path}")

if __name__ == "__main__":
    main()
