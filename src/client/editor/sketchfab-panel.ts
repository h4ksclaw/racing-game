/**
 * Sketchfab search panel — search, results rendering, download buttons.
 */
import { API_BASE } from "./editor-main.js";

const sfSearchInput = document.getElementById("sf-search") as HTMLInputElement;
const sfSearchBtn = document.getElementById("sf-search-btn")!;
const sfSortSelect = document.getElementById("sf-sort") as HTMLSelectElement | null;
const sfResults = document.getElementById("sf-results")!;
let sfNextCursor: string | null = null;
let sfCurrentQuery = "";
let sfCurrentSort = "-likeCount";
let onAssetSelected: ((path: string, name: string) => void) | null = null;

export function initSketchfabPanel(onSelect: (path: string, name: string) => void): void {
	onAssetSelected = onSelect;
	sfSearchBtn.addEventListener("click", () => sketchfabSearch(sfSearchInput.value.trim()));
	sfSearchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") sketchfabSearch(sfSearchInput.value.trim());
	});
	sfSortSelect?.addEventListener("change", () => {
		if (sfCurrentQuery) sketchfabSearch(sfCurrentQuery);
	});
}

export function loadPendingAssets(): void {
	const pendingContainer = document.getElementById("pending-assets")!;
	(async () => {
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
				div.addEventListener("click", () => {
					const path = `/api/assets/file/${asset.hash}`;
					const name = asset.originalName.replace(/\.(glb|gltf)$/i, "");
					onAssetSelected?.(path, name);
				});
				pendingContainer.appendChild(div);
			}
		} catch {
			pendingContainer.innerHTML = '<div style="color:var(--muted);font-size:11px;">Failed to load</div>';
		}
	})();
}

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
	const MAX_SIZE = 50 * 1024 * 1024;
	const filtered = results.filter((r) => {
		if (!r.isCc) return false;
		return Number(r.estimatedSize ?? 0) <= MAX_SIZE;
	});

	if (filtered.length === 0 && !append) {
		sfResults.innerHTML =
			'<div style="color:var(--muted);font-size:11px;">No CC-licensed models found. Try different keywords.</div>';
		return;
	}

	for (const r of filtered) {
		const div = document.createElement("div");
		div.className = "sf-item";
		const name = String(r.name ?? "Unnamed");
		const author = String(r.author ?? "");
		const license = String(r.license ?? "");
		const url = String(r.url ?? "");
		const thumb = String(r.thumbnail ?? "");
		const faces = Number(r.faceCount ?? 0);
		const likes = Number(r.likeCount ?? 0);
		const estSize = Number(r.estimatedSize ?? 0);
		const faceStr = faces > 0 ? `${(faces / 1000).toFixed(0)}k faces` : "";
		const likeStr = likes > 0 ? `♥${likes}` : "";
		const sizeStr = formatBytes(estSize);
		const metaParts = [faceStr, likeStr, sizeStr].filter(Boolean);
		const bigThumb = thumb.replace(/\/(\d+)\//, "/512/");

		div.innerHTML = bigThumb ? `<img class="sf-thumb" src="${bigThumb}" alt="" loading="lazy">` : "";
		div.innerHTML += `
			<div class="sf-name">${name}</div>
			<div class="sf-meta">
				${ccBadge(r.isCc === true, license)}
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
		div.title = `"${name}" by ${author}\nLicense: ${license}\nSource: ${url}`;
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
