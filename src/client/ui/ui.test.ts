// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import "./index.ts";
import type { LitElement } from "lit";

function p(el: LitElement): Record<string, unknown> {
	return el as unknown as Record<string, unknown>;
}

async function mk(tag: string): Promise<LitElement> {
	const el = document.createElement(tag) as unknown as LitElement;
	document.body.appendChild(el);
	await el.updateComplete;
	return el;
}

function rm(el: LitElement): void {
	document.body.removeChild(el);
}

describe("UI Components", () => {
	describe("Component registration", () => {
		const tags = [
			"system-bar",
			"car-nameplate",
			"speed-display",
			"rpm-bar",
			"session-badge",
			"lap-timer",
			"tire-temps",
			"gear-strip",
			"steer-indicator",
			"pedal-bars",
			"damage-bar",
			"speed-trap",
			"race-toast",
			"race-minimap",
			"controls-help",
			"loading-screen",
		];

		for (const tag of tags) {
			it(`${tag} is registered`, () => {
				expect(customElements.get(tag)).toBeDefined();
			});
		}
	});

	describe("Default property values", () => {
		it("speed-display defaults to 0", async () => {
			const el = await mk("speed-display");
			expect(p(el).speed).toBe(0);
			expect(p(el).gear).toBe(0);
			expect(p(el).rpm).toBe(0);
			rm(el);
		});

		it("rpm-bar defaults to 0", async () => {
			const el = await mk("rpm-bar");
			expect(p(el).rpm).toBe(0);
			expect(p(el).segments).toBe(8);
			rm(el);
		});

		it("session-badge defaults", async () => {
			const el = await mk("session-badge");
			expect(p(el).type).toBe("");
			expect(p(el).elapsed).toBe(0);
			rm(el);
		});

		it("gear-strip defaults to 0 (neutral)", async () => {
			const el = await mk("gear-strip");
			expect(p(el).gear).toBe(0);
			rm(el);
		});

		it("damage-bar defaults to 100", async () => {
			const el = await mk("damage-bar");
			expect(p(el).health).toBe(100);
			rm(el);
		});

		it("steer-indicator defaults to 0", async () => {
			const el = await mk("steer-indicator");
			expect(p(el).input).toBe(0);
			rm(el);
		});

		it("pedal-bars defaults to 0", async () => {
			const el = await mk("pedal-bars");
			expect(p(el).throttle).toBe(0);
			expect(p(el).brake).toBe(0);
			rm(el);
		});

		it("speed-trap defaults to 0", async () => {
			const el = await mk("speed-trap");
			expect(p(el).topSpeed).toBe(0);
			rm(el);
		});

		it("loading-screen defaults", async () => {
			const el = await mk("loading-screen");
			expect(p(el).message).toBe("Loading...");
			expect(p(el).visible).toBe(false);
			rm(el);
		});

		it("race-toast defaults", async () => {
			const el = await mk("race-toast");
			expect(p(el).message).toBe("");
			expect(p(el).type).toBe("ok");
			expect(p(el).visible).toBe(false);
			rm(el);
		});

		it("tire-temps defaults to 0", async () => {
			const el = await mk("tire-temps");
			expect(p(el).fl).toBe(0);
			expect(p(el).fr).toBe(0);
			expect(p(el).rl).toBe(0);
			expect(p(el).rr).toBe(0);
			rm(el);
		});
	});

	describe("Reactive property updates", () => {
		it("speed-display updates on property change", async () => {
			const el = await mk("speed-display");
			const r = p(el);
			r.speed = 180;
			r.gear = 5;
			r.rpm = 0.9;
			await el.updateComplete;
			expect(r.speed).toBe(180);
			expect(r.gear).toBe(5);
			expect(r.rpm).toBe(0.9);
			rm(el);
		});

		it("gear-strip updates gear", async () => {
			const el = await mk("gear-strip");
			const r = p(el);
			r.gear = -1;
			await el.updateComplete;
			expect(r.gear).toBe(-1);
			r.gear = 3;
			await el.updateComplete;
			expect(r.gear).toBe(3);
			rm(el);
		});

		it("damage-bar updates health", async () => {
			const el = await mk("damage-bar");
			const r = p(el);
			r.health = 25;
			await el.updateComplete;
			expect(r.health).toBe(25);
			rm(el);
		});
	});

	describe("Edge cases", () => {
		it("speed-display handles negative speed", async () => {
			const el = await mk("speed-display");
			p(el).speed = -50;
			await el.updateComplete;
			expect(p(el).speed).toBe(-50);
			const text = el.shadowRoot?.textContent ?? "";
			expect(text).not.toContain("-50");
			rm(el);
		});

		it("gear-strip handles gear -1 (reverse)", async () => {
			const el = await mk("gear-strip");
			p(el).gear = -1;
			await el.updateComplete;
			const html = el.shadowRoot?.innerHTML ?? "";
			expect(html).toContain("active");
			rm(el);
		});

		it("rpm-bar handles rpm 0 and 1", async () => {
			const el = await mk("rpm-bar");
			const r = p(el);
			r.rpm = 0;
			await el.updateComplete;
			expect(r.rpm).toBe(0);
			r.rpm = 1;
			await el.updateComplete;
			expect(r.rpm).toBe(1);
			rm(el);
		});

		it("damage-bar handles health 0", async () => {
			const el = await mk("damage-bar");
			p(el).health = 0;
			await el.updateComplete;
			expect(p(el).health).toBe(0);
			const html = el.shadowRoot?.innerHTML ?? "";
			expect(html).toContain("0%");
			rm(el);
		});

		it("tire-temps handles extreme values", async () => {
			const el = await mk("tire-temps");
			const r = p(el);
			r.fl = 50;
			r.fr = 110;
			r.rl = 80;
			r.rr = 95;
			await el.updateComplete;
			expect(r.fl).toBe(50);
			expect(r.fr).toBe(110);
			rm(el);
		});
	});

	describe("Theme styles", () => {
		it("components apply CSS custom properties", async () => {
			const el = await mk("speed-display");
			const style = el.shadowRoot?.querySelector("style")?.textContent ?? "";
			expect(style).toContain("--ui-accent");
			expect(style).toContain("--ui-panel");
			rm(el);
		});
	});
});
