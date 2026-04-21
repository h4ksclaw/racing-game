/**
 * Editor UI — wires all editor modules to the DOM.
 */
import * as THREE from "three";

import { type AutoDetectResult, autoDetect } from "./auto-detect.js";
import { bakeModel } from "./bake-export.js";
import { clearGhost, showExpectedGhost, updateDimensions } from "./dimension-overlay.js";
import {
	API_BASE,
	type EditorMode,
	getCamera,
	getCurrentModel,
	getOrbitControls,
	handleSelectClick,
	init,
	loadGLB,
	setMode,
	setModelScale,
	setSelectedObjectUUID,
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
import {
	deleteObject as deleteModelObject,
	duplicateMaterialForObject,
	markObjectAs,
	toggleObjectVisibility,
} from "./object-manager.js";
import { initObjectPanel, onObjectDelete, onObjectMark, onObjectSelect, refreshObjectPanel } from "./object-panel.js";
import { createPhysicsPanel, getPhysicsOverrides, onOverridesChange } from "./physics-editor.js";
import { hideSuspensionRange, showSuspensionRange } from "./suspension-viz.js";
import { fitCameraToModel, setViewPreset } from "./view-controls.js";

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
const sfSortSelect = document.getElementById("sf-sort") as HTMLSelectElement | null;
const sfResults = document.getElementById("sf-results")!;
let sfNextCursor: string | null = null;
let sfCurrentQuery = "";
let sfCurrentSort = "-likeCount";

async function sketchfabSearch(query: string, cursor?: string) {
	if (query.length < 2) return;
	sfCurrentQuery = query;
	sfCurrentSort = sfSortSelect?.value || "-likeCount";
	const params = new URLSearchParams({ q: query, limit: "12", sort_by: sfCurrentSort });
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

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

function ccBadge(isCc: boolean, license: string): string {
	if (!isCc) return `<span style="color:#888;font-size:10px;">${license}</span>`;
	return `<span style="background:#2d5a27;color:#a5d6a7;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;">CC ✓</span>`;
}

function renderSketchfabResults(results: Array<Record<string, unknown>>, append: boolean) {
	if (!append) sfResults.innerHTML = "";

	// Client-side filter: only CC models, reasonable size
	const MAX_SIZE = 50 * 1024 * 1024;
	const filtered = results.filter((r) => {
		if (!r.isCc) return false;
		const est = Number(r.estimatedSize ?? 0);
		if (est > MAX_SIZE) return false;
		return true;
	});

	if (filtered.length === 0) {
		sfResults.innerHTML = append
			? sfResults.innerHTML
			: '<div style="color:var(--muted);font-size:11px;">No CC-licensed models found. Try different keywords.</div>';
		return;
	}

	for (const r of filtered) {
		const div = document.createElement("div");
		div.className = "sf-item";
		const faces = Number(r.faceCount ?? 0);
		const likes = Number(r.likeCount ?? 0);
		const license = String(r.license ?? "");
		const isCc = r.isCc === true;
		const author = String(r.author ?? "");
		const url = String(r.url ?? "");
		const name = String(r.name ?? "Unnamed");
		const thumb = String(r.thumbnail ?? "");
		const estSize = Number(r.estimatedSize ?? 0);

		const faceStr = faces > 0 ? `${(faces / 1000).toFixed(0)}k faces` : "";
		const likeStr = likes > 0 ? `♥${likes}` : "";
		const sizeStr = formatBytes(estSize);
		const metaParts = [faceStr, likeStr, sizeStr].filter(Boolean);

		// Use larger thumbnail for better preview
		const bigThumb = thumb.replace(/\/(\d+)\//, "/512/");

		div.innerHTML = bigThumb ? `<img class="sf-thumb" src="${bigThumb}" alt="" loading="lazy">` : "";
		div.innerHTML += `
			<div class="sf-name">${name}</div>
			<div class="sf-meta">
				${ccBadge(isCc, license)}
				${metaParts.length ? ` · ${metaParts.join(" · ")}` : ""}
				${author ? ` · ${author}` : ""}
				${url ? ` · <a href="${url}" target="_blank" rel="noopener">Sketchfab ↗</a>` : ""}
			</div>
			<div class="sf-meta">
				<button class="sf-download-btn" data-uid="${r.uid}" data-name="${name}" data-license="${license}" data-author="${author}" data-url="${url}">⬇ Download</button>
				<span class="sf-download-status" data-uid="${r.uid}"></span>
			</div>
			<div style="clear:both"></div>
		`;

		// Attribution tooltip on hover
		div.title = `"${name}" by ${author}\nLicense: ${license}\nSource: ${url}`;

		sfResults.appendChild(div);
	}

	// Attach download button handlers
	for (const btn of sfResults.querySelectorAll<HTMLButtonElement>(".sf-download-btn")) {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const uid = btn.dataset.uid!;
			const statusEl = sfResults.querySelector<HTMLSpanElement>(`.sf-download-status[data-uid="${uid}"]`);
			if (statusEl) statusEl.textContent = "Downloading...";
			btn.disabled = true;

			try {
				const resp = await fetch(`${API_BASE}/sketchfab/download`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ uid }),
				});
				const data = await resp.json();
				if (resp.ok) {
					if (statusEl) statusEl.textContent = `✓ ${data.name} (${formatBytes(data.size ?? 0)})`;
					loadPendingAssets();
				} else {
					if (statusEl) statusEl.textContent = `✗ ${data.error}`;
					btn.disabled = false;
				}
			} catch {
				if (statusEl) statusEl.textContent = "✗ Network error";
				btn.disabled = false;
			}
		});
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
if (sfSortSelect) {
	sfSortSelect.addEventListener("change", () => {
		if (sfCurrentQuery) sketchfabSearch(sfCurrentQuery);
	});
}

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

document.getElementById("btn-wireframe")?.addEventListener("click", function () {
	this.classList.toggle("active");
	toggleWireframe();
});

document.getElementById("btn-dims")?.addEventListener("click", function () {
	this.classList.toggle("active");
	toggleDims();
	updateDimensions();
});

document.getElementById("btn-autodetect")?.addEventListener("click", () => {
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

// ── Object panel ──
initObjectPanel(document.getElementById("object-panel")!);
onObjectSelect((uuid) => setSelectedObjectUUID(uuid));
onObjectMark((uuid, type) => {
	const model = getCurrentModel();
	if (!model) return;
	if (type === "_toggleVis") {
		toggleObjectVisibility(model, uuid);
	} else if (type === "_dupMat") {
		const obj = model.getObjectByProperty("uuid", uuid);
		if (obj) duplicateMaterialForObject(obj, `bloom_${obj.name || "material"}`);
	} else {
		markObjectAs(model, uuid, type);
	}
	refreshObjectPanel(model);
});
onObjectDelete((uuid) => {
	const model = getCurrentModel();
	if (!model) return;
	deleteModelObject(model, uuid);
	refreshObjectPanel(model);
});

// ── View preset buttons ──
for (const view of ["front", "back", "top", "left", "right"] as const) {
	const btn = document.getElementById(`btn-view-${view}`);
	if (!btn) continue;
	btn.addEventListener("click", () => {
		const model = getCurrentModel();
		if (!model) return;
		const box = new THREE.Box3().setFromObject(model);
		const center = box.getCenter(new THREE.Vector3());
		setViewPreset(view, getCamera(), getOrbitControls(), center);
	});
}

document.getElementById("btn-fit")?.addEventListener("click", () => {
	const model = getCurrentModel();
	if (!model) return;
	fitCameraToModel(getCamera(), getOrbitControls(), model);
});

// ── Viewport clicks ──
viewport.addEventListener("click", (e) => {
	if (handleSelectClick(e)) return;
	handleViewportClick(e);
});

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
		div.querySelector("[data-action=place]")?.addEventListener("click", () => {
			setPendingType(m.type);
			setMode("place");
			toolbarBtns.forEach((b) => {
				b.classList.toggle("active", b.dataset.mode === "place");
			});
		});
		div.querySelector("[data-action=delete]")?.addEventListener("click", () => removeMarker(m.id));
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
document.getElementById("btn-export")?.addEventListener("click", async () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, currentScale.x, getMarkers());
	const result = await saveConfig(payload);
	if (result.ok) {
		alert("Config saved!");
	} else {
		alert(`Save failed: ${result.error}`);
	}
});

document.getElementById("btn-download")?.addEventListener("click", () => {
	const payload = generateExport(currentCarName || "unnamed", currentModelPath, currentScale.x, getMarkers());
	downloadJSON(payload);
});

function refreshUI() {
	refreshMarkerList();
	refreshValidation();
	refreshObjectPanel(getCurrentModel());
}

// ── Import Car Flow ──
const importSection = document.getElementById("import-section");
const importSteps = document.querySelectorAll(".import-step");
let importStep = 0;
const selectedCarMetadataId: number | null = null;
const sketchfabAttribution = "";

function setImportStep(step: number) {
	importStep = step;
	importSteps.forEach((el, i) => {
		el.classList.toggle("active", i <= step);
		el.classList.toggle("done", i < step);
	});
	document.querySelectorAll(".import-panel").forEach((el, i) => {
		(el as HTMLElement).style.display = i === step ? "block" : "none";
	});
}

if (importSection) {
	const nextBtn = document.getElementById("import-next-btn");
	const prevBtn = document.getElementById("import-prev-btn");
	const bakeBtn = document.getElementById("import-bake-btn") as HTMLButtonElement | null;

	if (nextBtn) nextBtn.addEventListener("click", () => setImportStep(importStep + 1));
	if (prevBtn) prevBtn.addEventListener("click", () => setImportStep(Math.max(0, importStep - 1)));

	// Initialize physics panel
	const physicsContainer = document.getElementById("physics-panel-container");
	if (physicsContainer) createPhysicsPanel(physicsContainer);

	// Suspension viz toggle
	const suspToggle = document.getElementById("susp-viz-toggle") as HTMLInputElement | null;
	if (suspToggle) {
		suspToggle.addEventListener("change", () => {
			if (suspToggle.checked) {
				const model = getCurrentModel();
				if (model) showSuspensionRange(model, getMarkers(), getPhysicsOverrides());
			} else {
				hideSuspensionRange();
			}
		});
	}

	onOverridesChange((overrides) => {
		const t = document.getElementById("susp-viz-toggle") as HTMLInputElement | null;
		if (t?.checked) {
			const model = getCurrentModel();
			if (model) showSuspensionRange(model, getMarkers(), overrides);
		}
	});

	// Bake & Submit
	if (bakeBtn) {
		bakeBtn.addEventListener("click", async () => {
			const model = getCurrentModel();
			if (!model) {
				alert("No model loaded");
				return;
			}
			const markers = getMarkers();
			const issues = validateMarkers(markers);
			if (issues.some((i) => i.type === "error")) {
				alert(
					"Fix errors: " +
						issues
							.filter((i) => i.type === "error")
							.map((i) => i.message)
							.join(", "),
				);
				return;
			}

			bakeBtn.disabled = true;
			bakeBtn.textContent = "Baking...";

			try {
				const bakeResult = await bakeModel(model, markers, { includeMarkers: true, applyObjectMarks: true });

				bakeBtn.textContent = "Uploading to S3...";

				const formData = new FormData();
				formData.append(
					"model",
					new Blob([bakeResult.glbBuffer], { type: "model/gltf-binary" }),
					`${currentCarName || "car"}.glb`,
				);
				const s3Resp = await fetch(`${API_BASE}/s3/upload`, { method: "POST", body: formData });
				if (!s3Resp.ok) throw new Error(`S3 upload failed: ${s3Resp.status}`);
				const { key: s3Key } = await s3Resp.json();

				bakeBtn.textContent = "Saving config...";

				const physics = getPhysicsOverrides();
				const exportPayload = generateExport(currentCarName || "unnamed", `s3:${s3Key}`, currentScale.x, markers);
				const attribution =
					(document.getElementById("import-attribution") as HTMLTextAreaElement)?.value || sketchfabAttribution || "";

				const importResp = await fetch(`${API_BASE}/cars/import`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						config: exportPayload.chassis,
						modelSchema: exportPayload.schema,
						physicsOverrides: physics,
						attribution,
						s3Key,
						carMetadataId: selectedCarMetadataId ?? undefined,
					}),
				});

				if (!importResp.ok) throw new Error(`Import failed: ${importResp.status}`);
				const result = await importResp.json();
				bakeBtn.textContent = `✓ Imported (ID: ${result.configId})`;
				setTimeout(() => {
					bakeBtn.textContent = "Bake & Submit";
					bakeBtn.disabled = false;
				}, 3000);
			} catch (err) {
				bakeBtn.textContent = "✕ Error";
				alert(`Import failed: ${err}`);
				setTimeout(() => {
					bakeBtn.textContent = "Bake & Submit";
					bakeBtn.disabled = false;
				}, 3000);
			}
		});
	}
}

// Initial UI state
refreshUI();
