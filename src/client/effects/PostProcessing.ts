/**
 * Post-processing effects: bloom, vignette, etc.
 * TODO: Implement using Three.js EffectComposer + passes.
 */

export class PostProcessing {
	resize(_width: number, _height: number): void {
		// TODO: Resize composer
	}

	render(): void {
		// TODO: composer.render() instead of renderer.render()
	}

	dispose(): void {
		// TODO: Dispose passes and composer
	}
}
