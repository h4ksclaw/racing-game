/**
 * Editor UI — wires all editor modules to the DOM.
 */

import { type AutoDetectResult, autoDetect } from "./auto-detect.js";
import { clearGhost, showExpectedGhost, updateDimensions } from "./dimension-overlay.js";
import {
	API_BASE,
	type EditorMode,
	getCurrentModel,
	init,
	loadGLB,
	setMode,
	setModelScale,
	toggleDims,
	toggleWireframe,
} from "./editor-main.js";
import { downloadJSON, generateExport, saveConfig, validateMarkers } from "./export.js";
import {
	clearMarkers,
	getMarkers,
	getMarkerTypes,
	handleViewportClick,
	onMarkersChange,
	placeMarker,
	removeMarker,
	setPendingType,
} from "./marker-tool.js";

// ── Init scene ──
const viewport = document.getElementById("viewport")!;
init(viewport);

// ── State ──
let currentCarName = "";
let currentModelPath = "";
let currentScale = { x: 1, y: 1, z: 1 };

// ── File upload ──
const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
	e.preventDefault();
	dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
	e.preventDefault();
	dropZone.classList.remove("drag-over");
	const file = e.dataTransfer?.files[0];
	if (file) uploadFile(file);
});
fileInput.addEventListener("change", () => {
	if (fileInput.files?.[0]) uploadFile(fileInput.files[0]);
});

async function uploadFile(file: File) {
	const formData = new FormData();
	formData.append("model", file);
	try {
		const resp = await fetch(`${API_BASE}/assets/upload`, { method: "POST", body: formData });
		const data = await resp.json();
		if (data.hash) {
			currentModelPath = `/api/assets/file/${data.hash}`;
			currentCarName = file.name.replace(/\.(glb|gltf)$/i, "");
			await loadGLB(currentModelPath);
			clearMarkers();
			clearGhost();
			updateDimensions();
			refreshUI();
		}
	} catch (err) {
		console.error("Upload failed:", err);
	}
}

// ── Pending assets browser ──
const pendingContainer = document.getElementById("pending-assets")!;

async function loadPendingAssets() {
	try {
		const resp = await fetch(`${API_BASE}/assets/pending`);
		const assets = await resp.json();
		pendingContainer.innerHTML = "";
		if (assets.length === 0) {
			pendingContainer.innerHTML = '<div style="color:var(--muted);font-size:11px;">No pending assets</div>';
			return;
		}
		for (const asset of assets) {
			const div = document.createElement("div");
			div.className = "pending-item";
			const sizeStr =
				asset.size > 1024 * 1024
					? `${(asset.size / 1024 / 1024).toFixed(1)} MB`
					: `${(asset.size / 1024).toFixed(0)} KB`;
			div.innerHTML = `<span class="pending-name">${asset.originalName}</span><span class="pending-size">${sizeStr}</span>`;
			div.addEventListener("click", async () => {
				currentModelPath = `/api/assets/file/${asset.hash}`;
				currentCarName = asset.originalName.replace(/\.(glb|gltf)$/i, "");
				await loadGLB(currentModelPath);
				clearMarkers();
				clearGhost();
				updateDimensions();
				refreshUI();
			});
			pendingContainer.appendChild(div);
		}
	} catch {
		pendingContainer.innerHTML = '<div style="color:var(--muted);font-size:11px;">Failed to load</div>';
	}
}

loadPendingAssets();

// ── Sketchfab search ──
const sfSearchInput = document.getElementById("sf-search") as HTMLInputElement;
const sfSearchBtn = document.getElementById("sf-search-btn")!;
const sfResults = document.getElementById("sf-results")!;
let sfNextCursor: string | null = null;
let sfCurrentQuery = "";

async function sketchfabSearch(query: string, cursor?: string) {
	if (query.length < 2) return;
	sfCurrentQuery = query;
	const params = new URLSearchParams({ q: query, limit: "12" });
	if (cursor) params.set("cursor", cursor);

	try {
		const resp = await fetch(`${API_BASE}/sketchfab/search?${params}`);
		const data = await resp.json();
		renderSketchfabResults(data.results, !!cursor);
		sfNextCursor = data.nextCursor || null;
	} catch {
		sfResults.innerHTML = '<div style="color:var(--muted);font-size:11px;">Search failed</div>';
	}
}

function renderSketchfabResults(results: Array<Record<string, unknown>>, append: boolean) {
	if (!append) sfResults.innerHTML = "";

	for (const r of results) {
		const div = document.createElement("div");
		div.className = "sf-item";
		const faces = Number(r.faceCount ?? 0);
		const likes = Number(r.likeCount ?? 0);
		const license = String(r.license ?? "");
		const author = String(r.author ?? "");
		const url = String(r.url ?? "");
		const name = String(r.name ?? "Unnamed");
		const thumb = String(r.thumbnail ?? "");

		const faceStr = faces > 0 ? `${(faces / 1000).toFixed(0)}k faces` : "";
		const likeStr = likes > 0 ? `♥${likes}` : "";
		const metaParts = [faceStr, likeStr, license].filter(Boolean);

		div.innerHTML = thumb ? `<img class="sf-thumb" src="${thumb}" alt="" loading="lazy">` : "";
		div.innerHTML += `
			<div class="sf-name">${name}</div>
			<div class="sf-meta">
				${metaParts.join(" · ")}
				${author ? ` · ${author}` : ""}
				${url ? ` · <a href="${url}" target="_blank" rel="noopener">Sketchfab ↗</a>` : ""}
			</div>
			<div style="clear:both"></div>
		`;

		sfResults.appendChild(div);
	}

	// Load more button
	if (sfNextCursor) {
		let loadMore = sfResults.querySelector(".sf-load-more") as HTMLElement | null;
		if (!loadMore) {
			loadMore = document.createElement("div");
			loadMore.className = "sf-load-more";
			loadMore.textContent = "Load more...";
			loadMore.addEventListener("click", () => {
				if (sfNextCursor && sfCurrentQuery) sketchfabSearch(sfCurrentQuery, sfNextCursor);
			});
			sfResults.appendChild(loadMore);
		}
	} else {
		const existing = sfResults.querySelector(".sf-load-more");
		if (existing) existing.remove();
	}
}

sfSearchBtn.addEventListener("click", () => sketchfabSearch(sfSearchInput.value.trim()));
sfSearchInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") sketchfabSearch(sfSearchInput.value.trim());
});

// ── Car search ──
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results")!;
const carInfo = document.getElementById("car-info")!;
let searchTimeout: ReturnType<typeof setTimeout>;

searchInput.addEventListener("input", () => {
	clearTimeout(searchTimeout);
	const q = searchInput.value.trim();
	if (q.length < 2) {
		searchResults.classList.remove("active");
		return;
	}
	searchTimeout = setTimeout(async () => {
		try {
			const resp = await fetch(`${API_BASE}/cars/search?q=${encodeURIComponent(q)}`);
			const cars = await resp.json();
			renderSearchResults(cars);
		} catch {
			/* ignore */
		}
	}, 300);
});

searchInput.addEventListener("blur", () => setTimeout(() => searchResults.classList.remove("active"), 200));

interface CarMeta {
	name: string;
	modelPath: string;
	modelScale: number;
	weightKg: number;
	lengthM?: number;
	widthM?: number;
	heightM?: number;
}

function renderSearchResults(cars: CarMeta[]) {
	searchResults.innerHTML = "";
	if (cars.length === 0) {
		searchResults.classList.remove("active");
		return;
	}
	searchResults.classList.add("active");
	for (const car of cars.slice(0, 10)) {
		const div = document.createElement("div");
		div.className = "search-item";
		div.textContent = car.name;
		div.addEventListener("mousedown", () => selectCar(car));
		searchResults.appendChild(div);
	}
}

async function selectCar(car: CarMeta) {
	currentCarName = car.name;
	currentModelPath = car.modelPath;
	const scale = car.modelScale || 1;
	currentScale = { x: scale, y: scale, z: scale };
	searchInput.value = car.name;
	searchResults.classList.remove("active");

	// Show car info
	carInfo.classList.add("active");
	document.getElementById("car-dims")!.textContent =
		`${car.lengthM ?? "?"} × ${car.widthM ?? "?"} × ${car.heightM ?? "?"} m`;
	document.getElementById("car-weight")!.textContent = `${car.weightKg ?? "?"} kg`;
	document.getElementById("car-model")!.textContent = car.modelPath.split("/").pop() ?? "";

	// Update scale sliders
	for (const axis of ["u", "x", "y", "z"]) {
		const slider = document.getElementById(`scale-${axis}`) as HTMLInputElement;
		slider.value = String(scale);
		const valEl = document.getElementById(`scale-${axis}-val`);
		if (valEl) valEl.textContent = scale.toFixed(2);
	}

	try {
		await loadGLB(car.modelPath);
		setModelScale(scale, scale, scale);
		clearMarkers();
		updateDimensions();

		if (car.lengthM && car.widthM && car.heightM) {
			showExpectedGhost(car.lengthM, car.widthM, car.heightM);
		} else {
			clearGhost();
		}
		refreshUI();
	} catch (err) {
		console.error("Failed to load model:", err);
	}
}

// ── Scale controls ──
for (const axis of ["u", "x", "y", "z"] as const) {
	const slider = document.getElementById(`scale-${axis}`) as HTMLInputElement;
	slider.addEventListener("input", () => {
		const val = parseFloat(slider.value);
		document.getElementById(`scale-${axis}-val`)!.textContent = val.toFixed(2);
		applyScale(val, axis);
	});
}

function applyScale(val: number, changed: string) {
	if (changed === "u") {
		currentScale = { x: val, y: val, z: val };
		for (const a of ["x", "y", "z"]) {
			(document.getElementById(`scale-${a}`) as HTMLInputElement).value = String(val);
			document.getElementById(`scale-${a}-val`)!.textContent = val.toFixed(2);
		}
	} else {
		(currentScale as any)[changed] = val;
	}
	setModelScale(currentScale.x, currentScale.y, currentScale.z);
	updateDimensions();
}

// ── Toolbar ──
const toolbarBtns = document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-mode]");
for (const btn of toolbarBtns) {
	btn.addEventListener("click", () => {
		for (const b of toolbarBtns) b.classList.remove("active");
		btn.classList.add("active");
		setMode(btn.dataset.mode as EditorMode);
		// Auto-select marker type for place mode
		if (btn.dataset.mode === "place") {
			const nextType = getNextMissingMarkerType();
			setPendingType(nextType);
		} else {
			setPendingType(null);
		}
	});
}

document.getElementById("btn-wireframe")!.addEventListener("click", function () {
	this.classList.toggle("active");
	toggleWireframe();
});

document.getElementById("btn-dims")!.addEventListener("click", function () {
	this.classList.toggle("active");
	toggleDims();
	updateDimensions();
});

document.getElementById("btn-autodetect")!.addEventListener("click", () => {
	const model = getCurrentModel();
	if (!model) return;
	const result = autoDetect(model);
	applyAutoDetect(result);
});

function getNextMissingMarkerType(): string {
	const markers = getMarkers();
	const types = getMarkerTypes();
	for (const t of types) {
		if (!markers.find((m) => m.type === t)) return t;
	}
	return "PhysicsMarker";
}

// ── Viewport clicks ──
viewport.addEventListener("click", handleViewportClick);

// ── Marker list ──
onMarkersChange(() => {
	refreshMarkerList();
	refreshValidation();
});

function refreshMarkerList() {
	const list = document.getElementById("marker-list")!;
	list.innerHTML = "";

	const markers = getMarkers();
	const typeOrder = getMarkerTypes();
	const sorted = [...markers].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

	const colors: Record<string, string> = {
		PhysicsMarker: "#4a9eff",
		Wheel_FL: "#4aff8b",
		Wheel_FR: "#8bff4a",
		Wheel_RL: "#4aff8b",
		Wheel_RR: "#8bff4a",
		Headlight_L: "#ffffff",
		Headlight_R: "#ffffff",
		Taillight_L: "#ff2222",
		Taillight_R: "#ff2222",
		Exhaust_L: "#ff8844",
		Exhaust_R: "#ff8844",
	};

	for (const m of sorted) {
		const div = document.createElement("div");
		div.className = "marker-item";
		div.innerHTML = `
			<span class="marker-dot" style="background:${colors[m.type] ?? "#ff00ff"}"></span>
			<span class="marker-name">${m.type}</span>
			<span class="marker-pos">${m.position.x.toFixed(2)}, ${m.position.y.toFixed(2)}, ${m.position.z.toFixed(2)}</span>
			<button class="marker-btn" data-action="place" data-type="${m.type}">↻</button>
			<button class="marker-btn del" data-action="delete" data-id="${m.id}">✕</button>
		`;
		div.querySelector("[data-action=place]")!.addEventListener("click", () => {
			setPendingType(m.type);
			setMode("place");
			toolbarBtns.forEach((b) => {
				b.classList.toggle("active", b.dataset.mode === "place");
			});
		});
		div.querySelector("[data-action=delete]")!.addEventListener("click", () => removeMarker(m.id));
		list.appendChild(div);
	}
}

function refreshValidation() {
	const div = document.getElementById("validation")!;
	const issues = validateMarkers(getMarkers());
	if (issues.length === 0) {
		div.innerHTML = '<div class="val-item ok">✓ All checks passed</div>';
		return;
	}
	div.innerHTML = issues
		.map((i) => `<div class="val-item ${i.type}">${i.type === "error" ? "✕" : "⚠"} ${i.message}</div>`)
		.join("");
}

function applyAutoDetect(result: AutoDetectResult) {
	for (const w of result.wheels) {
		placeMarker(w.type, w.position);
	}
	for (const l of result.lights) {
		placeMarker(l.type, l.position);
	}
	for (const e of result.exhausts) {
		placeMarker(e.type, e.position);
	}
}

// ── Export ──
document.getElementById("btn-export")!.addEventListener("click", async () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, currentScale.x, getMarkers());
	const result = await saveConfig(payload);
	if (result.ok) {
		alert("Config saved!");
	} else {
		alert(`Save failed: ${result.error}`);
	}
});

document.getElementById("btn-download")!.addEventListener("click", () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, currentScale.x, getMarkers());
	downloadJSON(payload);
});

function refreshUI() {
	refreshMarkerList();
	refreshValidation();
}

// Initial UI state
refreshUI();
