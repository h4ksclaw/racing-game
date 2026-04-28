/** Type definitions for dependency-cruiser output. */

export interface ModuleNode {
	source: string;
	dependencies: DependencyEdge[];
	/* Extracted from source path */
	package?: string;
	bundleSize?: {
		size: number;
		rulesSize: number;
		preGzippedSize: number;
		gzippedSize: number;
	};
	couldNotResolve?: boolean;
	coreModule?: boolean;
	circular?: boolean;
	instability?: number;
}

export interface DependencyEdge {
	resolved: string;
	circular?: boolean;
	module: string;
	moduleSystem: string;
	dynamic: boolean;
	exoticallyRequired: boolean;
	dependencyTypes: string[];
	couldNotResolve?: boolean;
	preCompilationOnly?: boolean;
	reachable?: boolean;
}

export interface DepcruiseResult {
	modules: ModuleNode[];
	summary: {
		totalModules: number;
		totalDependencies: number;
		rules?: DepcruiseRule[];
	};
}

export interface DepcruiseRule {
	name: string;
	severity: string;
	comment?: string;
	from: { path?: string; pathNot?: string };
	to: { path?: string; pathNot?: string; circular?: boolean; reachable?: boolean };
}

/** Simplified node used by the force-directed graph. */
export interface GraphNode {
	id: string;
	label: string;
	group: "client" | "server" | "shared";
	x: number;
	y: number;
	vx: number;
	vy: number;
	degree: number;
	inDegree: number;
	outDegree: number;
	circular: boolean;
	violations: string[]; // rule names that flag this node
}

/** Simplified edge for the graph. */
export interface GraphEdge {
	source: string;
	target: string;
	circular: boolean;
	violation: boolean;
}
