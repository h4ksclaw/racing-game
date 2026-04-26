/**
 * Face overlay — renders selected/highlighted faces as a colored overlay on the mesh.
 * Uses a separate THREE.Mesh with vertex colors. Zero geometry duplication — only
 * vertex color attributes are created.
 */
import * as THREE from "three";

const HIGHLIGHT_COLOR = new THREE.Color(0x00ff88); // green for current selection
const GROUP_COLORS = [
	new THREE.Color(0xff3344), // red
	new THREE.Color(0x4488ff), // blue
	new THREE.Color(0xffaa00), // orange
	new THREE.Color(0xaa44ff), // purple
	new THREE.Color(0x44ffaa), // teal
	new THREE.Color(0xff44aa), // pink
	new THREE.Color(0xaaff44), // lime
	new THREE.Color(0xffdd44), // yellow
];

export class FaceOverlayManager {
	private overlayMesh: THREE.Mesh | null = null;
	private currentMesh: THREE.Mesh | null = null;
	private currentFaces: Set<number> | null = null;
	private colorIndex = 0;
	private _visible = true;

	/** Set overlay visibility (respects highlight toggle). */
	setVisible(v: boolean): void {
		this._visible = v;
		if (this.overlayMesh) this.overlayMesh.visible = v;
	}

	get visible(): boolean {
		return this._visible;
	}

	/** Update the overlay to show the given faces on the given mesh. */
	update(mesh: THREE.Mesh, faces: Set<number>, color?: THREE.Color): void {
		// If same mesh and no change, skip
		if (this.currentMesh === mesh && this.currentFaces && this.facesEqual(this.currentFaces, faces)) {
			return;
		}

		this.clear();
		this.currentMesh = mesh;
		this.currentFaces = new Set(faces);

		const geo = mesh.geometry;
		if (!geo.attributes.position) return;

		const vertCount = geo.attributes.position.count;
		const colors = new Float32Array(vertCount * 3);
		const c = color ?? HIGHLIGHT_COLOR;

		// Mark vertices of selected faces with the highlight color
		const index = geo.index;
		if (index) {
			for (const faceIdx of faces) {
				const i0 = index.getX(faceIdx * 3);
				const i1 = index.getX(faceIdx * 3 + 1);
				const i2 = index.getX(faceIdx * 3 + 2);
				colors[i0 * 3] = c.r;
				colors[i0 * 3 + 1] = c.g;
				colors[i0 * 3 + 2] = c.b;
				colors[i1 * 3] = c.r;
				colors[i1 * 3 + 1] = c.g;
				colors[i1 * 3 + 2] = c.b;
				colors[i2 * 3] = c.r;
				colors[i2 * 3 + 1] = c.g;
				colors[i2 * 3 + 2] = c.b;
			}
		} else {
			for (const faceIdx of faces) {
				const base = faceIdx * 3;
				for (let v = 0; v < 3; v++) {
					colors[(base + v) * 3] = c.r;
					colors[(base + v) * 3 + 1] = c.g;
					colors[(base + v) * 3 + 2] = c.b;
				}
			}
		}

		// Share the geometry (no clone!) — just add vertex colors
		// We need a separate geometry because we're adding color attribute
		// But we reuse the position/index buffers via reference
		const overlayGeo = new THREE.BufferGeometry();
		overlayGeo.setAttribute("position", geo.attributes.position);
		if (geo.index) {
			overlayGeo.setIndex(geo.index);
		}
		if (geo.attributes.normal) {
			overlayGeo.setAttribute("normal", geo.attributes.normal);
		}
		overlayGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		overlayGeo.boundingSphere = geo.boundingSphere; // share bounding sphere

		const material = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.35,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});

		this.overlayMesh = new THREE.Mesh(overlayGeo, material);
		this.overlayMesh.name = "__face_overlay";
		this.overlayMesh.matrixAutoUpdate = false;
		this.overlayMesh.visible = this._visible;

		// Copy world matrix from the source mesh
		mesh.updateMatrixWorld(true);
		this.overlayMesh.matrixWorld.copy(mesh.matrixWorld);

		// Add to the mesh's parent (same level as the mesh)
		if (mesh.parent) {
			mesh.parent.add(this.overlayMesh);
		}
	}

	/** Show virtual group highlights — multiple groups in different colors. */
	updateGroups(
		mesh: THREE.Mesh,
		groups: Record<string, { faces: number[]; color?: string }>,
	): void {
		this.clear();
		this.currentMesh = mesh;

		const geo = mesh.geometry;
		if (!geo.attributes.position) return;

		const vertCount = geo.attributes.position.count;
		const colors = new Float32Array(vertCount * 3);

		let groupIdx = 0;
		for (const [_key, group] of Object.entries(groups)) {
			const c = group.color
				? new THREE.Color(group.color)
				: GROUP_COLORS[groupIdx % GROUP_COLORS.length];
			groupIdx++;

			const index = geo.index;
			if (index) {
				for (const faceIdx of group.faces) {
					const i0 = index.getX(faceIdx * 3);
					const i1 = index.getX(faceIdx * 3 + 1);
					const i2 = index.getX(faceIdx * 3 + 2);
					colors[i0 * 3] = c.r;
					colors[i0 * 3 + 1] = c.g;
					colors[i0 * 3 + 2] = c.b;
					colors[i1 * 3] = c.r;
					colors[i1 * 3 + 1] = c.g;
					colors[i1 * 3 + 2] = c.b;
					colors[i2 * 3] = c.r;
					colors[i2 * 3 + 1] = c.g;
					colors[i2 * 3 + 2] = c.b;
				}
			} else {
				for (const faceIdx of group.faces) {
					const base = faceIdx * 3;
					for (let v = 0; v < 3; v++) {
						colors[(base + v) * 3] = c.r;
						colors[(base + v) * 3 + 1] = c.g;
						colors[(base + v) * 3 + 2] = c.b;
					}
				}
			}
		}

		const overlayGeo = new THREE.BufferGeometry();
		overlayGeo.setAttribute("position", geo.attributes.position);
		if (geo.index) {
			overlayGeo.setIndex(geo.index);
		}
		if (geo.attributes.normal) {
			overlayGeo.setAttribute("normal", geo.attributes.normal);
		}
		overlayGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		overlayGeo.boundingSphere = geo.boundingSphere;

		const material = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.25,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});

		this.overlayMesh = new THREE.Mesh(overlayGeo, material);
		this.overlayMesh.name = "__face_overlay";
		this.overlayMesh.matrixAutoUpdate = false;
		this.overlayMesh.visible = this._visible;
		mesh.updateMatrixWorld(true);
		this.overlayMesh.matrixWorld.copy(mesh.matrixWorld);

		if (mesh.parent) {
			mesh.parent.add(this.overlayMesh);
		}
	}

	/** Remove the overlay from the scene. */
	clear(): void {
		if (this.overlayMesh) {
			this.overlayMesh.geometry.dispose();
			const mat = this.overlayMesh.material;
			if (!Array.isArray(mat)) mat.dispose();
			this.overlayMesh.parent?.remove(this.overlayMesh);
			this.overlayMesh = null;
		}
		this.currentMesh = null;
		this.currentFaces = null;
	}

	/** Sync the overlay transform if the source mesh moved. */
	syncTransform(): void {
		if (this.overlayMesh && this.currentMesh) {
			this.currentMesh.updateMatrixWorld(true);
			this.overlayMesh.matrixWorld.copy(this.currentMesh.matrixWorld);
		}
	}

	/** Get the next color in the cycle (for virtual group coloring). */
	nextColor(): string {
		const c = GROUP_COLORS[this.colorIndex % GROUP_COLORS.length];
		this.colorIndex++;
		return `#${c.getHexString()}`;
	}

	private facesEqual(a: Set<number>, b: Set<number>): boolean {
		if (a.size !== b.size) return false;
		for (const v of a) {
			if (!b.has(v)) return false;
		}
		return true;
	}
}
