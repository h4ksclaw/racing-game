/**
 * Racing game UI — Lit-based overlay components.
 *
 * Design system:
 * - Dark, semi-transparent panels that float over the 3D canvas
 * - Accent color: #00e5a0 (neon green) — feels sporty/racing
 * - Secondary: #ff6b35 (orange) for warnings/speed
 * - Glass-morphism: backdrop-filter blur + semi-transparent backgrounds
 * - Mobile-first, touch-friendly sizing
 * - All components are Web Components — drop into any HTML
 */

export { ControlPanel } from "./control-panel.ts";
export { GameHud } from "./game-hud.ts";
export { NotificationToast } from "./notification-toast.ts";
export { SettingsPanel } from "./settings-panel.ts";
export { WorldControls } from "./world-controls.ts";
