import { css } from "lit";

export const themeStyles = css`
	:host {
		--ui-purple: rgba(139,92,246,1);
		--ui-purple-dim: rgba(139,92,246,0.35);
		--ui-purple-faint: rgba(139,92,246,0.12);
		--ui-purple-ghost: rgba(139,92,246,0.06);
		--ui-red: rgba(244,63,94,0.6);
		--ui-red-dim: rgba(244,63,94,0.06);
		--ui-green: rgba(163,230,53,0.6);
		--ui-green-dim: rgba(163,230,53,0.15);
		--ui-amber: rgba(251,191,36,0.7);
		--ui-amber-dim: rgba(251,191,36,0.15);
		--ui-panel: rgba(10,8,18,0.82);
		--ui-panel-solid: rgba(10,8,18,0.9);
		--ui-text: rgba(255,255,255,0.45);
		--ui-text-bright: rgba(255,255,255,0.7);
		--ui-text-white: #fff;
		--ui-mono: 'JetBrains Mono', monospace;
		--ui-sans: 'Inter', sans-serif;
		--ui-border: 1px solid var(--ui-purple-faint);
	}
`;
