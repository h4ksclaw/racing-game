/**
 * Central editor state — single source of truth for editor-wide state.
 * Replaces scattered module-level variables across editor-ui, editor-main, scale-controls, etc.
 */

export interface CarSelection {
	name: string;
	dims: { length_m: number; width_m: number; height_m: number } | null;
	modelPath: string;
	scale: { x: number; y: number; z: number };
}

export interface EditorState {
	car: CarSelection;
	wireframe: boolean;
	showDims: boolean;
}

const state: EditorState = {
	car: { name: "", dims: null, modelPath: "", scale: { x: 1, y: 1, z: 1 } },
	wireframe: false,
	showDims: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function getEditorState(): EditorState {
	return state;
}

export function setCarSelection(partial: Partial<CarSelection>): void {
	Object.assign(state.car, partial);
	notify();
}

export function setCarScale(x: number, y: number, z: number): void {
	state.car.scale = { x, y, z };
	notify();
}

export function setWireframe(value: boolean): void {
	state.wireframe = value;
	notify();
}

export function setShowDims(value: boolean): void {
	state.showDims = value;
	notify();
}

export function onStateChange(cb: Listener): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function notify(): void {
	for (const cb of listeners) cb();
}
