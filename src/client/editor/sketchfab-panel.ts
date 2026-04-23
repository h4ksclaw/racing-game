/**
 * Sketchfab search panel — search, results rendering, download buttons.
 */
import { API_BASE } from "./editor-main.js";

const sfSortSelect = document.getElementById("sf-sort") as HTMLSelectElement | null;
const sfResults = document.getElementById("sf-results")!;
let sfNextCursor: string | null = null;
let sfCurrentQuery = "";
let sfCurrentSort = "-likeCount";
let onAssetSelected: ((path: string, name: string, attribution?: string) => void) | null = null;

export function initSketchfabPanel(onSelect: (path: string, name: string, attribution?: string) => void): void {
	onAssetSelected = onSelect;
	sfSortSelect?.addEventListener("change", () => {
		if (sfCurrentQuery) sketchfabSearch(sfCurrentQuery);
	});
}

/** Trigger a search from external code (e.g. car database selection). */
export function searchSketchfab(query: string): void {
	sketchfabSearch(query);
	// Update the search label
	const label = document.getElementById("sf-search-label");
	if (label) label.textContent = query;
}

export function collapseSketchfabPanel(): void {
	const panels = document.querySelectorAll("editor-panel");
	for (const p of panels) {
		if ((p as HTMLElement & { title?: string }).title === "Sketchfab") {
			(p as any).collapsed = true;
		}
	}
}

export function loadPendingAssets(): void {
	const pendingContainer = document.getElementById("pending-assets")!;
	(async () => {
		try {
			const resp = await fetch(`${API_BASE}/assets/pending`);
			const assets = await resp.json();
			pendingContainer.innerHTML = "";
			if (assets.length === 0) {
				pendingContainer.innerHTML = '<div class="sf-empty">No pending assets</div>';
				return;
			}
			for (const asset of assets) {
				const div = document.createElement("div");
				div.className = "pending-item";
				const sizeStr =
					asset.size > 1024 * 1024
						? `${(asset.size / 1024 / 1024).toFixed(1)} MB`
						: `${(asset.size / 1024).toFixed(0)} KB`;
				div.innerHTML = `
					<span class="pending-name">${asset.originalName}</span>
					<span class="pending-size">${sizeStr}</span>
					<button class="pending-delete-btn" data-hash="${asset.hash}" title="Delete asset">&times;</button>
				`;
				// Click name to load model
				const nameEl = div.querySelector(".pending-name");
				nameEl?.addEventListener("click", async () => {
					if (nameEl.classList.contains("loading")) return;
					nameEl.classList.add("loading");
					const originalText = nameEl.textContent ?? "";
					nameEl.textContent = `Loading ${originalText}...`;
					try {
						const path = `/api/assets/file/${asset.hash}`;
						const name = asset.originalName.replace(/\.(glb|gltf)$/i, "");
						onAssetSelected?.(path, name, asset.attribution);
					} finally {
						nameEl.classList.remove("loading");
						nameEl.textContent = originalText;
					}
				});
				// Click delete to remove
				div.querySelector(".pending-delete-btn")?.addEventListener("click", async (e) => {
					e.stopPropagation();
					const btn = e.currentTarget as HTMLElement;
					btn.textContent = "...";
					btn.style.pointerEvents = "none";
					try {
						const delResp = await fetch(`${API_BASE}/assets/${asset.hash}`, {
							method: "DELETE",
						});
						if (delResp.ok) {
							div.remove();
							// Remove "No pending assets" placeholder if this was the last one
							if (pendingContainer.children.length === 0) {
								pendingContainer.innerHTML = '<div class="sf-empty">No pending assets</div>';
							}
						} else {
							btn.textContent = "!";
							setTimeout(() => {
								btn.textContent = "×";
								btn.style.pointerEvents = "";
							}, 1500);
						}
					} catch {
						btn.textContent = "!";
						setTimeout(() => {
							btn.textContent = "×";
							btn.style.pointerEvents = "";
						}, 1500);
					}
				});
				pendingContainer.appendChild(div);
			}
		} catch {
			pendingContainer.innerHTML = '<div class="sf-empty">Failed to load</div>';
		}
	})();
}

async function sketchfabSearch(query: string, cursor?: string) {
	if (query.length < 2) return;
	sfCurrentQuery = query;
	sfCurrentSort = sfSortSelect?.value || "-likeCount";
	const params = new URLSearchParams({
		q: query,
		limit: "12",
		sort_by: sfCurrentSort,
	});
	if (cursor) params.set("cursor", cursor);

	try {
		const resp = await fetch(`${API_BASE}/sketchfab/search?${params}`);
		const data = await resp.json();
		renderSketchfabResults(data.results, !!cursor);
		sfNextCursor = data.nextCursor || null;
	} catch {
		sfResults.innerHTML = '<div class="sf-empty">Search failed</div>';
	}
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

function renderSketchfabResults(results: Array<Record<string, unknown>>, append: boolean) {
	if (!append) sfResults.innerHTML = "";

	if (results.length === 0 && !append) {
		sfResults.innerHTML = '<div class="sf-empty">No models found. Try different keywords.</div>';
		return;
	}

	for (const r of results) {
		const div = document.createElement("div");
		div.className = "sf-item";
		const name = String(r.name ?? "Unnamed");
		const author = String(r.author ?? "");
		const license = String(r.license ?? "");
		const url = String(r.url ?? "");
		const thumb = String(r.thumbnail ?? "");
		const faces = Number(r.faceCount ?? 0);
		const verts = Number(r.vertexCount ?? 0);
		const likes = Number(r.likeCount ?? 0);
		// Estimate GLB size: ~30 bytes per vertex for typical game models
		const estSize = verts > 0 ? verts * 30 : 0;
		const faceStr = faces > 0 ? `${(faces / 1000).toFixed(0)}k tris` : "";
		const vertStr = verts > 0 ? `${(verts / 1000).toFixed(0)}k verts` : "";
		const likeStr = likes > 0 ? `${likes} likes` : "";
		const sizeStr = estSize > 0 ? formatBytes(estSize) : "";
		const metaParts = [vertStr, faceStr, sizeStr, likeStr].filter(Boolean);
		const bigThumb = thumb.replace(/\/(\d+)\//, "/512/");

		div.innerHTML = bigThumb ? `<img class="sf-thumb" src="${bigThumb}" alt="" loading="lazy">` : "";
		div.innerHTML += `
			<div class="sf-name">${name}</div>
			<div class="sf-meta">
				${r.isCc === true ? `<span class="cc-badge">CC</span>` : `<span style="color:var(--ui-red)">${license}</span>`}
				${license ? ` <span style="color:var(--ui-text)">${license}</span>` : ""}
				${metaParts.length ? ` · ${metaParts.join(" · ")}` : ""}
				${author ? ` · ${author}` : ""}
				${url ? ` · <a href="${url}" target="_blank" rel="noopener">Sketchfab ↗</a>` : ""}
			</div>
			<div class="sf-meta">
				<button class="sf-download-btn" data-uid="${r.uid}" data-name="${name}" data-license="${license}" data-author="${author}" data-url="${url}">Download</button>
				<span class="sf-download-status" data-uid="${r.uid}"></span>
			</div>
			<div style="clear:both"></div>
		`;
		div.title = `"${name}" by ${author}\nVerts: ${verts.toLocaleString()}\nFaces: ${faces.toLocaleString()}\nEst. GLB: ${sizeStr}\nLicense: ${license}\nSource: ${url}`;
		sfResults.appendChild(div);
	}

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
					if (statusEl) statusEl.textContent = `${data.name} (${formatBytes(data.size ?? 0)})`;
					loadPendingAssets();
				} else {
					if (statusEl) statusEl.textContent = `Failed: ${data.error}`;
					btn.disabled = false;
				}
			} catch {
				if (statusEl) statusEl.textContent = "Network error";
				btn.disabled = false;
			}
		});
	}

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
		sfResults.querySelector(".sf-load-more")?.remove();
	}
}
