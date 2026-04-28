/**
 * Interactive ER diagram renderer using Canvas2D.
 *
 * Displays database tables as styled boxes with columns, types, and PK/FK
 * indicators. Relations shown as lines with crow's-foot notation.
 * Supports pan, zoom, and table dragging (same interaction model as ForceGraph).
 */

interface ColumnDef {
	name: string;
	type: string;
	nullable: boolean;
	primaryKey: boolean;
	default?: string;
	references?: string;
}

interface TableDef {
	name: string;
	columns: ColumnDef[];
}

interface RelationDef {
	from: string;
	to: string;
	type: string;
	field: string;
}

export interface SchemaData {
	tables: TableDef[];
	relations: RelationDef[];
}

interface TableBox {
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	columns: ColumnDef[];
}

const TABLE_WIDTH = 260;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 24;
const PADDING = 8;
const TABLE_GAP_X = 80;
const TABLE_GAP_Y = 40;
const TABLE_BG = "#161926";
const TABLE_BORDER = "#2e3550";
const TABLE_HEADER_BG = "#1c2035";
const TABLE_HEADER_TEXT = "#f0f4ff";
const COL_TEXT = "#a0aec0";
const COL_TYPE = "#6b7394";
const PK_COLOR = "#facc15";
const FK_COLOR = "#5c9eff";
const REL_LINE_COLOR = "rgba(92, 158, 255, 0.4)";
const REL_LINE_HIGHLIGHT = "rgba(92, 158, 255, 0.8)";
const ARROW_SIZE = 8;

export class ERDiagram {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private tables: Map<string, TableBox> = new Map();
	private relations: RelationDef[] = [];
	private selectedTable: string | null = null;

	// View transform
	private offsetX = 0;
	private offsetY = 0;
	private scale = 1;

	// Interaction
	private dragging: string | null = null;
	private panning = false;
	private panStartX = 0;
	private panStartY = 0;
	private panOffsetX = 0;
	private panOffsetY = 0;
	private mouseDownX = 0;
	private mouseDownY = 0;
	private mouseDownTableId: string | null = null;
	private isDragThresholdReached = false;
	private static readonly DRAG_THRESHOLD = 3;

	constructor(canvas: HTMLCanvasElement, data: SchemaData) {
		this.canvas = canvas;
		// biome-ignore lint/style/noNonNullAssertion: HTMLCanvasElement always has 2d context
		this.ctx = canvas.getContext("2d")!;
		this.relations = data.relations;
		this.buildTables(data.tables);
		this.layoutTables();
		this.setupInteraction();
		this.resize();
		window.addEventListener("resize", () => this.resize());
	}

	private buildTables(tables: TableDef[]) {
		for (const table of tables) {
			const height = HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + PADDING * 2;
			this.tables.set(table.name, {
				name: table.name,
				x: 0,
				y: 0,
				width: TABLE_WIDTH,
				height,
				columns: table.columns,
			});
		}
	}

	private layoutTables() {
		// Arrange tables in a grid layout
		const tableNames = Array.from(this.tables.keys());
		const cols = 2;
		let x = 0;
		let y = 0;
		let rowMaxHeight = 0;

		for (let i = 0; i < tableNames.length; i++) {
			const table = this.tables.get(tableNames[i]);
			if (!table) continue;

			table.x = x;
			table.y = y;
			rowMaxHeight = Math.max(rowMaxHeight, table.height);

			if ((i + 1) % cols === 0) {
				x = 0;
				y += rowMaxHeight + TABLE_GAP_Y;
				rowMaxHeight = 0;
			} else {
				x += TABLE_WIDTH + TABLE_GAP_X;
			}
		}
	}

	// ── Rendering ──────────────────────────────────────────────────────

	draw() {
		const { ctx, canvas } = this;
		const w = canvas.width;
		const h = canvas.height;
		const dpr = window.devicePixelRatio || 1;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		// Background
		ctx.fillStyle = "#0d0f16";
		ctx.fillRect(0, 0, w, h);

		ctx.save();
		ctx.translate(w / 2 + this.offsetX, h / 2 + this.offsetY);
		ctx.scale(this.scale, this.scale);

		// Draw relations first (behind tables)
		for (const rel of this.relations) {
			this.drawRelation(rel);
		}

		// Draw tables
		for (const table of this.tables.values()) {
			this.drawTable(table);
		}

		ctx.restore();
	}

	private drawRelation(rel: RelationDef) {
		const fromTable = this.tables.get(rel.from);
		const toTable = this.tables.get(rel.to);
		if (!fromTable || !toTable) return;

		const isHighlighted = this.selectedTable === rel.from || this.selectedTable === rel.to;

		// Find best connection points (center of edges)
		const fromCenterX = fromTable.x + fromTable.width / 2;
		const fromCenterY = fromTable.y + fromTable.height / 2;
		const toCenterX = toTable.x + toTable.width / 2;
		const toCenterY = toTable.y + toTable.height / 2;

		const fromPoint = this.getTableEdgePoint(fromTable, toCenterX, toCenterY);
		const toPoint = this.getTableEdgePoint(toTable, fromCenterX, fromCenterY);

		const ctx = this.ctx;

		// Draw line
		ctx.strokeStyle = isHighlighted ? REL_LINE_HIGHLIGHT : REL_LINE_COLOR;
		ctx.lineWidth = isHighlighted ? 2 : 1.2;
		ctx.beginPath();
		ctx.moveTo(fromPoint.x, fromPoint.y);
		ctx.lineTo(toPoint.x, toPoint.y);
		ctx.stroke();

		// Draw arrow/crow's foot at the "to" end
		const dx = toPoint.x - fromPoint.x;
		const dy = toPoint.y - fromPoint.y;
		const angle = Math.atan2(dy, dx);

		if (rel.type === "1:N") {
			// Many side: draw crow's foot (two prongs)
			const prongLen = ARROW_SIZE;
			const prongSpread = Math.PI / 6;

			ctx.beginPath();
			ctx.moveTo(toPoint.x, toPoint.y);
			ctx.lineTo(
				toPoint.x - prongLen * Math.cos(angle - prongSpread),
				toPoint.y - prongLen * Math.sin(angle - prongSpread),
			);
			ctx.moveTo(toPoint.x, toPoint.y);
			ctx.lineTo(
				toPoint.x - prongLen * Math.cos(angle + prongSpread),
				toPoint.y - prongLen * Math.sin(angle + prongSpread),
			);
			ctx.stroke();

			// One side: draw single line perpendicular
			const oneLen = ARROW_SIZE * 0.7;
			const perpAngle = angle + Math.PI / 2;
			ctx.beginPath();
			ctx.moveTo(fromPoint.x + oneLen * Math.cos(perpAngle), fromPoint.y + oneLen * Math.sin(perpAngle));
			ctx.lineTo(fromPoint.x - oneLen * Math.cos(perpAngle), fromPoint.y - oneLen * Math.sin(perpAngle));
			ctx.stroke();
		} else {
			// Default: simple arrow
			ctx.beginPath();
			ctx.moveTo(toPoint.x, toPoint.y);
			ctx.lineTo(
				toPoint.x - ARROW_SIZE * Math.cos(angle - Math.PI / 6),
				toPoint.y - ARROW_SIZE * Math.sin(angle - Math.PI / 6),
			);
			ctx.moveTo(toPoint.x, toPoint.y);
			ctx.lineTo(
				toPoint.x - ARROW_SIZE * Math.cos(angle + Math.PI / 6),
				toPoint.y - ARROW_SIZE * Math.sin(angle + Math.PI / 6),
			);
			ctx.stroke();
		}

		// Draw label at midpoint
		const midX = (fromPoint.x + toPoint.x) / 2;
		const midY = (fromPoint.y + toPoint.y) / 2;
		ctx.font = "10px 'JetBrains Mono', monospace";
		ctx.fillStyle = isHighlighted ? "rgba(92, 158, 255, 0.9)" : "rgba(92, 158, 255, 0.5)";
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";

		// Background for label
		const label = `${rel.type} ${rel.field}`;
		const metrics = ctx.measureText(label);
		ctx.fillStyle = "#0d0f16";
		ctx.fillRect(midX - metrics.width / 2 - 3, midY - 14, metrics.width + 6, 14);
		ctx.fillStyle = isHighlighted ? "rgba(92, 158, 255, 0.9)" : "rgba(92, 158, 255, 0.5)";
		ctx.fillText(label, midX, midY - 2);
	}

	private getTableEdgePoint(table: TableBox, targetX: number, targetY: number): { x: number; y: number } {
		const cx = table.x + table.width / 2;
		const cy = table.y + table.height / 2;
		const dx = targetX - cx;
		const dy = targetY - cy;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);

		// Scale factor to reach edge
		const scaleX = absDx > 0 ? table.width / 2 / absDx : 0;
		const scaleY = absDy > 0 ? table.height / 2 / absDy : 0;
		const scale = Math.min(scaleX, scaleY);

		return { x: cx + dx * scale, y: cy + dy * scale };
	}

	private drawTable(table: TableBox) {
		const ctx = this.ctx;
		const isSelected = table.name === this.selectedTable;
		const x = table.x;
		const y = table.y;
		const w = table.width;
		const h = table.height;
		const radius = 6;

		// Shadow
		ctx.shadowColor = isSelected ? "rgba(92, 158, 255, 0.3)" : "rgba(0, 0, 0, 0.4)";
		ctx.shadowBlur = isSelected ? 16 : 8;
		ctx.shadowOffsetY = 2;

		// Table body
		this.roundRect(x, y, w, h, radius);
		ctx.fillStyle = TABLE_BG;
		ctx.fill();

		// Border
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;
		this.roundRect(x, y, w, h, radius);
		ctx.strokeStyle = isSelected ? "#5c9eff" : TABLE_BORDER;
		ctx.lineWidth = isSelected ? 2 : 1;
		ctx.stroke();

		// Header background
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + w - radius, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
		ctx.lineTo(x + w, y + HEADER_HEIGHT);
		ctx.lineTo(x, y + HEADER_HEIGHT);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
		ctx.fillStyle = TABLE_HEADER_BG;
		ctx.fill();
		ctx.restore();

		// Header separator line
		ctx.beginPath();
		ctx.moveTo(x, y + HEADER_HEIGHT);
		ctx.lineTo(x + w, y + HEADER_HEIGHT);
		ctx.strokeStyle = TABLE_BORDER;
		ctx.lineWidth = 1;
		ctx.stroke();

		// Table name
		ctx.font = "bold 13px 'IBM Plex Sans', sans-serif";
		ctx.fillStyle = TABLE_HEADER_TEXT;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(`📦 ${table.name}`, x + PADDING, y + HEADER_HEIGHT / 2);

		// Column count badge
		const colCount = `${table.columns.length}`;
		ctx.font = "10px 'JetBrains Mono', monospace";
		const countWidth = ctx.measureText(colCount).width + 8;
		ctx.fillStyle = "rgba(92, 158, 255, 0.15)";
		this.roundRect(x + w - countWidth - PADDING, y + HEADER_HEIGHT / 2 - 8, countWidth, 16, 3);
		ctx.fill();
		ctx.fillStyle = "#5c9eff";
		ctx.textAlign = "center";
		ctx.fillText(colCount, x + w - countWidth / 2 - PADDING, y + HEADER_HEIGHT / 2);

		// Columns
		ctx.textAlign = "left";
		for (let i = 0; i < table.columns.length; i++) {
			const col = table.columns[i];
			const rowY = y + HEADER_HEIGHT + i * ROW_HEIGHT + PADDING;

			// Alternating row background
			if (i % 2 === 0) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
				ctx.fillRect(x + 1, rowY - 2, w - 2, ROW_HEIGHT);
			}

			// PK/FK indicator
			let indicatorX = x + PADDING;
			if (col.primaryKey) {
				ctx.font = "bold 9px 'JetBrains Mono', monospace";
				ctx.fillStyle = PK_COLOR;
				ctx.fillText("PK", indicatorX, rowY + ROW_HEIGHT / 2 - 2);
				indicatorX += 22;
			} else if (col.references) {
				ctx.font = "bold 9px 'JetBrains Mono', monospace";
				ctx.fillStyle = FK_COLOR;
				ctx.fillText("FK", indicatorX, rowY + ROW_HEIGHT / 2 - 2);
				indicatorX += 22;
			} else {
				indicatorX += 22;
			}

			// Column name
			ctx.font = "12px 'JetBrains Mono', monospace";
			ctx.fillStyle = COL_TEXT;
			ctx.fillText(col.name, indicatorX, rowY + ROW_HEIGHT / 2 - 2);

			// Nullable indicator
			if (col.nullable) {
				const nameWidth = ctx.measureText(col.name).width;
				ctx.font = "9px 'JetBrains Mono', monospace";
				ctx.fillStyle = "rgba(244, 63, 94, 0.5)";
				ctx.fillText("?", indicatorX + nameWidth + 4, rowY + ROW_HEIGHT / 2 - 2);
			}

			// Type (right-aligned)
			ctx.font = "11px 'JetBrains Mono', monospace";
			ctx.fillStyle = COL_TYPE;
			ctx.textAlign = "right";
			ctx.fillText(col.type, x + w - PADDING, rowY + ROW_HEIGHT / 2 - 2);
			ctx.textAlign = "left";
		}
	}

	private roundRect(x: number, y: number, w: number, h: number, r: number) {
		const ctx = this.ctx;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r);
		ctx.lineTo(x + w, y + h - r);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		ctx.lineTo(x + r, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.closePath();
	}

	// ── Interaction ────────────────────────────────────────────────────

	private resize() {
		const dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.ctx.scale(dpr, dpr);
	}

	private setupInteraction() {
		this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
		this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
		this.canvas.addEventListener("mouseup", () => this.onMouseUp());
		this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
	}

	private screenToWorld(sx: number, sy: number): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		const cx = rect.width / 2 + this.offsetX;
		const cy = rect.height / 2 + this.offsetY;
		return [(sx - cx) / this.scale, (sy - cy) / this.scale];
	}

	private findTableAt(wx: number, wy: number): TableBox | null {
		for (const table of this.tables.values()) {
			if (wx >= table.x && wx <= table.x + table.width && wy >= table.y && wy <= table.y + table.height) {
				return table;
			}
		}
		return null;
	}

	private onMouseDown(e: MouseEvent) {
		this.mouseDownX = e.clientX;
		this.mouseDownY = e.clientY;
		this.isDragThresholdReached = false;

		const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
		const table = this.findTableAt(wx, wy);

		if (table) {
			this.mouseDownTableId = table.name;
			this.selectedTable = table.name;
		} else {
			this.mouseDownTableId = null;
			this.selectedTable = null;
			this.panning = true;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panOffsetX = this.offsetX;
			this.panOffsetY = this.offsetY;
		}
	}

	private onMouseMove(e: MouseEvent) {
		// Check drag threshold for tables
		if (this.mouseDownTableId && !this.isDragThresholdReached) {
			const dx = e.clientX - this.mouseDownX;
			const dy = e.clientY - this.mouseDownY;
			if (dx * dx + dy * dy > ERDiagram.DRAG_THRESHOLD * ERDiagram.DRAG_THRESHOLD) {
				this.isDragThresholdReached = true;
				this.dragging = this.mouseDownTableId;
			}
		}

		// Cursor
		if (!this.dragging && !this.panning) {
			const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
			const hovered = this.findTableAt(wx, wy);
			this.canvas.style.cursor = hovered ? "pointer" : "grab";
		}

		if (this.dragging) {
			const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
			const table = this.tables.get(this.dragging);
			if (table) {
				table.x = wx - table.width / 2;
				table.y = wy - table.height / 2;
			}
		} else if (this.panning) {
			this.offsetX = this.panOffsetX + (e.clientX - this.panStartX);
			this.offsetY = this.panOffsetY + (e.clientY - this.panStartY);
		}
	}

	private onMouseUp() {
		this.dragging = null;
		this.panning = false;
		this.mouseDownTableId = null;
		this.isDragThresholdReached = false;
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;

		const rect = this.canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		const cx = rect.width / 2 + this.offsetX;
		const cy = rect.height / 2 + this.offsetY;
		const wx = (mx - cx) / this.scale;
		const wy = (my - cy) / this.scale;

		this.scale *= factor;
		this.scale = Math.max(0.1, Math.min(5, this.scale));

		this.offsetX = mx - rect.width / 2 - wx * this.scale;
		this.offsetY = my - rect.height / 2 - wy * this.scale;
	}

	// ── Public API ─────────────────────────────────────────────────────

	resetView() {
		// Auto-fit to table bounds
		const boxes = Array.from(this.tables.values());
		if (boxes.length === 0) return;

		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const t of boxes) {
			minX = Math.min(minX, t.x);
			maxX = Math.max(maxX, t.x + t.width);
			minY = Math.min(minY, t.y);
			maxY = Math.max(maxY, t.y + t.height);
		}

		const padding = 100;
		const graphW = maxX - minX + padding * 2;
		const graphH = maxY - minY + padding * 2;
		const rect = this.canvas.getBoundingClientRect();
		const scaleX = rect.width / graphW;
		const scaleY = rect.height / graphH;
		this.scale = Math.min(scaleX, scaleY, 1.5);
		this.offsetX = (-(minX + maxX) / 2) * this.scale;
		this.offsetY = (-(minY + maxY) / 2) * this.scale;
	}

	zoom(factor: number) {
		this.scale *= factor;
		this.scale = Math.max(0.1, Math.min(5, this.scale));
	}
}
