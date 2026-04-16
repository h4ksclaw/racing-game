import { css } from "lit";

export const themeStyles = css`
	:host {
		--ui-bg: rgba(17, 19, 28, 1);
		--ui-panel: rgba(25, 29, 42, 0.92);
		--ui-panel-solid: rgba(25, 29, 42, 1);
		--ui-border: 1px solid rgba(46, 53, 80, 0.6);
		--ui-accent: rgba(92, 158, 255, 1);
		--ui-accent-dim: rgba(92, 158, 255, 0.35);
		--ui-accent-faint: rgba(92, 158, 255, 0.12);
		--ui-accent-ghost: rgba(92, 158, 255, 0.06);
		--ui-orange: rgba(255, 140, 75, 1);
		--ui-orange-dim: rgba(255, 140, 75, 0.35);
		--ui-orange-faint: rgba(255, 140, 75, 0.12);
		--ui-red: rgba(244, 63, 94, 0.6);
		--ui-red-dim: rgba(244, 63, 94, 0.06);
		--ui-green: rgba(163, 230, 53, 0.6);
		--ui-green-dim: rgba(163, 230, 53, 0.15);
		--ui-text: rgba(240, 244, 255, 0.45);
		--ui-text-bright: rgba(240, 244, 255, 0.7);
		--ui-text-white: #f0f4ff;
		--ui-mono: 'JetBrains Mono', monospace;
		--ui-sans: 'Inter', sans-serif;
	}
`;
