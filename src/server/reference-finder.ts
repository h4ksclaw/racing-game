/**
 * Symbol-level cross-reference analysis using ts-morph.
 *
 * Extracts exported symbols from TypeScript source files and finds
 * all references across the project. Used by the dev-insights API
 * to provide function/class-level drill-down in the dependency graph.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// ── Types ─────────────────────────────────────────────────────────────

export interface SymbolReference {
	filePath: string;
	line: number;
	column: number;
}

export interface SymbolInfo {
	name: string;
	kind: string;
	kindIcon: string;
	filePath: string;
	line: number;
	references: SymbolReference[];
}

// ── Lazy Project Cache ────────────────────────────────────────────────

let _project: Project | null = null;

function getProject(): Project {
	if (_project) return _project;
	_project = new Project({
		tsConfigFilePath: path.join(PROJECT_ROOT, "tsconfig.json"),
		skipAddingFilesFromTsConfig: false,
		compilerOptions: {
			noEmit: true,
		},
	});
	return _project;
}

// ── Symbol Extraction ─────────────────────────────────────────────────

function symbolKindInfo(kind: string): { kind: string; kindIcon: string } {
	switch (kind) {
		case "FunctionDeclaration":
			return { kind: "function", kindIcon: "ƒ" };
		case "ClassDeclaration":
			return { kind: "class", kindIcon: "◆" };
		case "InterfaceDeclaration":
			return { kind: "interface", kindIcon: "◇" };
		case "TypeAliasDeclaration":
			return { kind: "type", kindIcon: "T" };
		case "EnumDeclaration":
			return { kind: "enum", kindIcon: "≡" };
		case "VariableStatement":
			return { kind: "variable", kindIcon: "▪" };
		case "ExportAssignment":
			return { kind: "value", kindIcon: "▸" };
		default:
			return { kind: "unknown", kindIcon: "?" };
	}
}

/**
 * Extract all exported symbols from a specific source file.
 */
export function getExportedSymbols(filePath: string): SymbolInfo[] {
	const project = getProject();
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
	const sourceFile = project.getSourceFile(absolutePath);
	if (!sourceFile) return [];

	const symbols: SymbolInfo[] = [];

	// Functions
	for (const fn of sourceFile.getFunctions()) {
		if (fn.isExported()) {
			symbols.push(buildSymbolInfo(fn, fn.getName() ?? "anonymous", "FunctionDeclaration", sourceFile));
		}
	}

	// Classes
	for (const cls of sourceFile.getClasses()) {
		if (cls.isExported()) {
			symbols.push(buildSymbolInfo(cls, cls.getName() ?? "anonymous", "ClassDeclaration", sourceFile));
		}
	}

	// Interfaces
	for (const iface of sourceFile.getInterfaces()) {
		if (iface.isExported()) {
			symbols.push(buildSymbolInfo(iface, iface.getName() ?? "anonymous", "InterfaceDeclaration", sourceFile));
		}
	}

	// Type aliases
	for (const ta of sourceFile.getTypeAliases()) {
		if (ta.isExported()) {
			symbols.push(buildSymbolInfo(ta, ta.getName() ?? "anonymous", "TypeAliasDeclaration", sourceFile));
		}
	}

	// Enums
	for (const en of sourceFile.getEnums()) {
		if (en.isExported()) {
			symbols.push(buildSymbolInfo(en, en.getName() ?? "anonymous", "EnumDeclaration", sourceFile));
		}
	}

	// Exported variables (const, let, var)
	for (const vs of sourceFile.getVariableStatements()) {
		if (vs.isExported()) {
			const decls = vs.getDeclarations();
			if (decls.length > 0) {
				const name = decls[0].getName();
				if (name) {
					symbols.push(buildSymbolInfo(vs, name, "VariableStatement", sourceFile));
				}
			}
		}
	}

	// Export assignments (export default ...)
	for (const ea of sourceFile.getExportAssignments()) {
		const expr = ea.getExpression();
		const name = expr ? (expr.asKind(SyntaxKind.Identifier)?.getText() ?? "default") : "default";
		symbols.push(buildSymbolInfo(ea, name, "ExportAssignment", sourceFile));
	}

	return symbols;
}

function buildSymbolInfo(
	node: import("ts-morph").Node,
	name: string,
	kindName: string,
	sourceFile: SourceFile,
): SymbolInfo {
	const info = symbolKindInfo(kindName);
	const startLine = node.getStartLineNumber();
	const refs = findReferences(node);

	return {
		name,
		kind: info.kind,
		kindIcon: info.kindIcon,
		filePath: sourceFile.getFilePath().replace(PROJECT_ROOT, "").replace(/\\/g, "/").replace(/^\//, ""),
		line: startLine,
		references: refs,
	};
}

/**
 * Search for symbols by name across the entire project.
 */
export function searchSymbols(query: string): SymbolInfo[] {
	const project = getProject();
	const lowerQuery = query.toLowerCase();
	const results: SymbolInfo[] = [];
	const seen = new Set<string>();

	for (const sourceFile of project.getSourceFiles()) {
		const filePath = sourceFile.getFilePath();
		if (!filePath.includes("/src/") && !filePath.includes("\\src\\")) continue;

		const syms = getExportedSymbols(filePath);
		for (const sym of syms) {
			if (sym.name.toLowerCase().includes(lowerQuery)) {
				const key = `${sym.filePath}:${sym.name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				results.push(sym);
			}
		}
	}

	return results;
}

// ── Reference Finding ─────────────────────────────────────────────────

function findReferences(node: import("ts-morph").Node): SymbolReference[] {
	const refs: SymbolReference[] = [];

	try {
		// Use findReferencesAsNodes which returns an array of Node references
		const refNodes = (
			node as unknown as { findReferencesAsNodes: () => import("ts-morph").Node[] }
		).findReferencesAsNodes();

		for (const refNode of refNodes) {
			const refFile = refNode.getSourceFile();
			if (!refFile) continue;

			// Skip the declaration site itself
			const parent = refNode.getParent();
			if (parent && parent.getKind() === SyntaxKind.ExportKeyword) continue;

			const refFilePath = refFile.getFilePath().replace(PROJECT_ROOT, "").replace(/\\/g, "/").replace(/^\//, "");

			// Skip references from node_modules or declaration files
			if (refFilePath.includes("node_modules") || refFilePath.endsWith(".d.ts")) continue;

			// Deduplicate by file (we only need file-level references for the graph)
			const line = refNode.getStartLineNumber();
			const pos = refNode.getStart();
			const lc = refFile.getLineAndColumnAtPos(pos);
			const column = lc.column;

			// Only add if this file isn't the same as the declaration's file, or if it's a different usage
			const isDuplicate = refs.some((r) => r.filePath === refFilePath && r.line === line);
			if (isDuplicate) continue;

			refs.push({ filePath: refFilePath, line, column });
		}
	} catch {
		// Symbol resolution can fail for some constructs; just return empty
	}

	return refs;
}
