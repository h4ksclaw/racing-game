/**
 * Procedural house builder for Three.js.
 * Creates detailed houses with windows, doors, eaves, foundation, chimneys.
 */

import type { HouseItem } from "@shared/track.ts";
import * as THREE from "three";
import type { HouseConfig } from "./biomes.ts";
import { state } from "./scene.ts";

const GRID = 2; // Kenney kit grid unit size

// ── Materials (cached per tint) ─────────────────────────────────────────

interface MatSet {
	wall: THREE.MeshStandardMaterial;
	roof: THREE.MeshStandardMaterial;
	window: THREE.MeshStandardMaterial;
	frame: THREE.MeshStandardMaterial;
	door: THREE.MeshStandardMaterial;
	foundation: THREE.MeshStandardMaterial;
	chimney: THREE.MeshStandardMaterial;
	chimneyCap: THREE.MeshStandardMaterial;
	trim: THREE.MeshStandardMaterial;
}

const matCache = new Map<string, MatSet>();

function getMats(config: HouseConfig): MatSet {
	const key = `${config.wallColor}-${config.roofColor}-${config.chimney ? 1 : 0}`;
	let cached = matCache.get(key);
	if (cached) return cached;

	const wallCol = new THREE.Color(...config.wallColor);
	const roofCol = new THREE.Color(...config.roofColor);
	const frameCol = wallCol.clone().multiplyScalar(0.6);
	const doorCol = new THREE.Color(0.45, 0.28, 0.12);

	cached = {
		wall: new THREE.MeshStandardMaterial({ color: wallCol, roughness: 0.82 }),
		roof: new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.85 }),
		window: new THREE.MeshStandardMaterial({
			color: new THREE.Color(0.55, 0.4, 0.2),
			roughness: 0.3,
			metalness: 0.1,
			emissive: new THREE.Color(0.9, 0.7, 0.3),
			transparent: true,
			opacity: 0.75,
		}),
		frame: new THREE.MeshStandardMaterial({ color: frameCol, roughness: 0.7 }),
		door: new THREE.MeshStandardMaterial({ color: doorCol, roughness: 0.75 }),
		foundation: new THREE.MeshStandardMaterial({
			color: new THREE.Color(0.55, 0.5, 0.45),
			roughness: 0.95,
		}),
		chimney: new THREE.MeshStandardMaterial({
			color: wallCol.clone().multiplyScalar(0.75),
			roughness: 0.9,
		}),
		chimneyCap: new THREE.MeshStandardMaterial({
			color: new THREE.Color(0.4, 0.38, 0.35),
			roughness: 0.8,
		}),
		trim: new THREE.MeshStandardMaterial({
			color: roofCol.clone().multiplyScalar(0.85),
			roughness: 0.8,
		}),
	};
	matCache.set(key, cached);
	return cached;
}

// ── Roof geometry ───────────────────────────────────────────────────────

function createRoofGeo(width: number, depth: number, height: number): THREE.BufferGeometry {
	const hw = width / 2;
	const hd = depth / 2;
	const vertices = new Float32Array([
		// Left slope
		-hw,
		0,
		-hd,
		hw,
		0,
		-hd,
		0,
		height,
		-hd,
		-hw,
		0,
		hd,
		hw,
		0,
		hd,
		0,
		height,
		hd,
		// Front gable
		-hw,
		0,
		-hd,
		0,
		height,
		-hd,
		-hw,
		0,
		hd,
		// Back gable
		hw,
		0,
		-hd,
		hw,
		0,
		hd,
		0,
		height,
		-hd,
	]);
	const indices = [
		// Left slope
		0, 1, 2, 3, 4, 5,
		// Right slope (use same tri order, back faces for the other side)
		1, 0, 6, 6, 3, 1, 7, 4, 5, 5, 8, 7,
		// Front gable
		0, 2, 9, 9, 2, 3,
		// Back gable
		1, 10, 4, 10, 1, 2,
	];
	// Simpler approach: just 2 quads for slopes + 2 triangles for gables
	const verts = new Float32Array([
		// 4 base corners + peak front + peak back
		-hw,
		0,
		-hd, // 0: front-left
		hw,
		0,
		-hd, // 1: front-right
		-hw,
		0,
		hd, // 2: back-left
		hw,
		0,
		hd, // 3: back-right
		0,
		height,
		-hd, // 4: front peak
		0,
		height,
		hd, // 5: back peak
	]);
	const idx = [
		// Left slope
		0, 2, 5, 0, 5, 4,
		// Right slope
		1, 4, 5, 1, 5, 3,
		// Front gable
		0, 4, 1,
		// Back gable
		2, 3, 5,
	];
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

// ── Window builder ──────────────────────────────────────────────────────

function addWindow(
	parent: THREE.Group,
	x: number,
	y: number,
	z: number,
	rotY: number,
	w: number,
	h: number,
	mats: MatSet,
) {
	const grp = new THREE.Group();

	// Glass pane
	const glassGeo = new THREE.PlaneGeometry(w, h);
	const glass = new THREE.Mesh(glassGeo, mats.window);
	glass.position.z = 0.02;
	glass.userData.bloomMult = 1.5;
	state.houseWindows.push(glass);
	grp.add(glass);

	// Frame (4 thin boxes)
	const ft = 0.08; // frame thickness
	const fd = 0.06; // frame depth
	// Top
	const top = new THREE.Mesh(new THREE.BoxGeometry(w + ft * 2, ft, fd), mats.frame);
	top.position.set(0, h / 2 + ft / 2, 0);
	grp.add(top);
	// Bottom
	const bot = new THREE.Mesh(new THREE.BoxGeometry(w + ft * 2, ft, fd), mats.frame);
	bot.position.set(0, -h / 2 - ft / 2, 0);
	grp.add(bot);
	// Left
	const left = new THREE.Mesh(new THREE.BoxGeometry(ft, h + ft * 2, fd), mats.frame);
	left.position.set(-w / 2 - ft / 2, 0, 0);
	grp.add(left);
	// Right
	const right = new THREE.Mesh(new THREE.BoxGeometry(ft, h + ft * 2, fd), mats.frame);
	right.position.set(w / 2 + ft / 2, 0, 0);
	grp.add(right);
	// Cross bars
	const hBar = new THREE.Mesh(new THREE.BoxGeometry(w, ft * 0.6, fd * 0.8), mats.frame);
	hBar.position.set(0, 0, 0);
	grp.add(hBar);

	grp.position.set(x, y, z);
	grp.rotation.y = rotY;
	grp.castShadow = true;
	parent.add(grp);
}

// ── Door builder ────────────────────────────────────────────────────────

function addDoor(
	parent: THREE.Group,
	x: number,
	y: number,
	z: number,
	rotY: number,
	w: number,
	h: number,
	mats: MatSet,
) {
	const grp = new THREE.Group();
	// Door panel
	const doorGeo = new THREE.BoxGeometry(w, h, 0.12);
	const door = new THREE.Mesh(doorGeo, mats.door);
	door.position.z = 0.06;
	grp.add(door);
	// Frame
	const ft = 0.1;
	const fd = 0.08;
	const top = new THREE.Mesh(new THREE.BoxGeometry(w + ft * 2, ft, fd), mats.frame);
	top.position.set(0, h / 2 + ft / 2, 0);
	grp.add(top);
	const left = new THREE.Mesh(new THREE.BoxGeometry(ft, h + ft, fd), mats.frame);
	left.position.set(-w / 2 - ft / 2, 0, 0);
	grp.add(left);
	const right = new THREE.Mesh(new THREE.BoxGeometry(ft, h + ft, fd), mats.frame);
	right.position.set(w / 2 + ft / 2, 0, 0);
	grp.add(right);
	// Step
	const stepGeo = new THREE.BoxGeometry(w + 0.4, 0.15, 0.5);
	const step = new THREE.Mesh(stepGeo, mats.foundation);
	step.position.set(0, -h / 2 - 0.075, 0.3);
	grp.add(step);

	grp.position.set(x, y, z);
	grp.rotation.y = rotY;
	grp.castShadow = true;
	parent.add(grp);
}

// ── Main builder ────────────────────────────────────────────────────────

export function buildHouses(
	houses: HouseItem[],
	config: HouseConfig,
	terrain: { getHeight: (x: number, z: number) => number },
): THREE.Group {
	const group = new THREE.Group();
	if (!config.enabled || houses.length === 0) return group;

	const mats = getMats(config);

	for (const house of houses) {
		const { position, rotation, width, depth, wallHeight, roofPitch } = house;
		const groundY = terrain.getHeight(position.x, position.z);
		const mesh = new THREE.Group();

		const overhang = 0.5;
		const foundW = width + overhang * 2;
		const foundD = depth + overhang * 2;

		// Foundation slab
		const foundGeo = new THREE.BoxGeometry(foundW + 0.3, 0.2, foundD + 0.3);
		const foundMesh = new THREE.Mesh(foundGeo, mats.foundation);
		foundMesh.position.y = 0.1;
		foundMesh.receiveShadow = true;
		mesh.add(foundMesh);

		// Walls
		const wallGeo = new THREE.BoxGeometry(width, wallHeight, depth);
		const wallMesh = new THREE.Mesh(wallGeo, mats.wall);
		wallMesh.position.y = wallHeight / 2 + 0.2;
		wallMesh.castShadow = true;
		wallMesh.receiveShadow = true;
		mesh.add(wallMesh);

		const wallTop = 0.2 + wallHeight; // Y of wall top

		// Windows — front face (+Z), back face (-Z), sides (+X, -X)
		const winW = Math.min(1.2, width * 0.25);
		const winH = Math.min(1.0, wallHeight * 0.35);
		const winY = wallTop - winH * 0.8;

		// Front windows (1-2 depending on width)
		if (width > 3) {
			// Door in center, windows on sides
			const spacing = width * 0.35;
			addWindow(mesh, -spacing, winY, depth / 2 + 0.02, 0, winW, winH, mats);
			addWindow(mesh, spacing, winY, depth / 2 + 0.02, 0, winW, winH, mats);
			// Door
			const doorW = Math.min(1.1, width * 0.2);
			const doorH = Math.min(2.2, wallHeight * 0.75);
			addDoor(mesh, 0, wallTop - doorH / 2, depth / 2 + 0.02, 0, doorW, doorH, mats);
		} else {
			// Small house: door front, window on one side
			const doorW = Math.min(1.0, width * 0.3);
			const doorH = Math.min(2.0, wallHeight * 0.7);
			addDoor(mesh, 0, wallTop - doorH / 2, depth / 2 + 0.02, 0, doorW, doorH, mats);
		}

		// Back windows
		addWindow(mesh, 0, winY, -depth / 2 - 0.02, Math.PI, winW, winH, mats);
		if (width > 4) {
			addWindow(mesh, -width * 0.3, winY, -depth / 2 - 0.02, Math.PI, winW, winH, mats);
			addWindow(mesh, width * 0.3, winY, -depth / 2 - 0.02, Math.PI, winW, winH, mats);
		}

		// Side windows
		const sideWinW = Math.min(1.0, depth * 0.3);
		const sideWinH = winH;
		addWindow(mesh, -width / 2 - 0.02, winY, 0, -Math.PI / 2, sideWinW, sideWinH, mats);
		addWindow(mesh, width / 2 + 0.02, winY, 0, Math.PI / 2, sideWinW, sideWinH, mats);
		if (depth > 3) {
			addWindow(
				mesh,
				-width / 2 - 0.02,
				winY,
				depth * 0.25,
				-Math.PI / 2,
				sideWinW,
				sideWinH,
				mats,
			);
			addWindow(
				mesh,
				-width / 2 - 0.02,
				winY,
				-depth * 0.25,
				-Math.PI / 2,
				sideWinW,
				sideWinH,
				mats,
			);
			addWindow(mesh, width / 2 + 0.02, winY, depth * 0.25, Math.PI / 2, sideWinW, sideWinH, mats);
			addWindow(mesh, width / 2 + 0.02, winY, -depth * 0.25, Math.PI / 2, sideWinW, sideWinH, mats);
		}

		// Roof
		const roofH = (foundW / 2) * roofPitch;
		const roofGeo = createRoofGeo(foundW, foundD, roofH);
		const roofMesh = new THREE.Mesh(roofGeo, mats.roof);
		roofMesh.position.y = wallTop;
		roofMesh.castShadow = true;
		roofMesh.receiveShadow = true;
		mesh.add(roofMesh);

		// Chimney
		if (config.chimney) {
			const chimW = 0.5;
			const chimH = roofH * 1.3;
			const chimD = 0.5;
			const chimX = width * 0.2;
			const chimZ = -depth * 0.15;
			// Calculate chimney base Y (where it intersects roof slope)
			const chimRoofY = roofH * (1 - Math.abs(chimX) / (foundW / 2)) * 0.5;
			const chim = new THREE.Mesh(new THREE.BoxGeometry(chimW, chimH, chimD), mats.chimney);
			chim.position.set(chimX, wallTop + chimRoofY + chimH / 2, chimZ);
			chim.castShadow = true;
			mesh.add(chim);
			// Cap
			const cap = new THREE.Mesh(
				new THREE.BoxGeometry(chimW + 0.12, 0.12, chimD + 0.12),
				mats.chimneyCap,
			);
			cap.position.set(chimX, wallTop + chimRoofY + chimH + 0.06, chimZ);
			mesh.add(cap);
		}

		// Trim line along the wall top (fascia)
		const trimGeo = new THREE.BoxGeometry(width + 0.1, 0.1, 0.15);
		const trimFront = new THREE.Mesh(trimGeo, mats.trim);
		trimFront.position.set(0, wallTop, depth / 2 + overhang / 2);
		mesh.add(trimFront);
		const trimBack = new THREE.Mesh(trimGeo, mats.trim);
		trimBack.position.set(0, wallTop, -depth / 2 - overhang / 2);
		mesh.add(trimBack);

		mesh.position.set(position.x, groundY, position.z);
		mesh.rotation.y = rotation;
		group.add(mesh);
	}

	return group;
}
