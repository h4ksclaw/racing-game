import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig, getAllBiomes, validateGuardrailConfig } from "./biomes.ts";

describe("validateGuardrailConfig", () => {
	it("accepts the default config", () => {
		expect(validateGuardrailConfig(DEFAULT_GUARDRAIL_CONFIG)).toBeNull();
	});

	it("accepts all 6 biome guardrail configs", () => {
		for (const biome of getAllBiomes()) {
			if (biome.guardrail) {
				expect(validateGuardrailConfig(biome.guardrail)).toBeNull();
			}
		}
	});

	it("rejects postSpacing <= 0", () => {
		const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, postSpacing: 0 };
		expect(validateGuardrailConfig(cfg)).toMatch("postSpacing");
	});

	it("rejects postHeight <= 0", () => {
		const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, postHeight: -1 };
		expect(validateGuardrailConfig(cfg)).toMatch("postHeight");
	});

	it("rejects rail y >= postHeight", () => {
		const cfg: GuardrailConfig = {
			...DEFAULT_GUARDRAIL_CONFIG,
			rails: [
				{
					y: 2.0,
					halfWidth: 0.02,
					color: [1, 1, 1],
					metalness: 0.5,
					roughness: 0.5,
				},
			],
			railCount: 1,
		};
		expect(validateGuardrailConfig(cfg)).toMatch("postHeight");
	});

	it("rejects railCount mismatch with rails.length", () => {
		const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, railCount: 1 };
		expect(validateGuardrailConfig(cfg)).toMatch("rails.length");
	});

	it("rejects halfWidth <= 0", () => {
		const cfg: GuardrailConfig = {
			...DEFAULT_GUARDRAIL_CONFIG,
			rails: [
				{
					y: 0.5,
					halfWidth: 0,
					color: [1, 1, 1],
					metalness: 0.5,
					roughness: 0.5,
				},
			],
			railCount: 1,
		};
		expect(validateGuardrailConfig(cfg)).toMatch("halfWidth");
	});

	it("rejects color values outside 0-1", () => {
		const cfg: GuardrailConfig = {
			...DEFAULT_GUARDRAIL_CONFIG,
			rails: [
				{
					y: 0.5,
					halfWidth: 0.02,
					color: [1.5, 0, 0],
					metalness: 0.5,
					roughness: 0.5,
				},
			],
			railCount: 1,
		};
		expect(validateGuardrailConfig(cfg)).toMatch("color");
	});

	it("rejects metalness outside 0-1", () => {
		const cfg: GuardrailConfig = {
			...DEFAULT_GUARDRAIL_CONFIG,
			rails: [
				{
					y: 0.5,
					halfWidth: 0.02,
					color: [1, 1, 1],
					metalness: 1.5,
					roughness: 0.5,
				},
			],
			railCount: 1,
		};
		expect(validateGuardrailConfig(cfg)).toMatch("metalness");
	});

	it("rejects roughness outside 0-1", () => {
		const cfg: GuardrailConfig = {
			...DEFAULT_GUARDRAIL_CONFIG,
			rails: [
				{
					y: 0.5,
					halfWidth: 0.02,
					color: [1, 1, 1],
					metalness: 0.5,
					roughness: -0.1,
				},
			],
			railCount: 1,
		};
		expect(validateGuardrailConfig(cfg)).toMatch("roughness");
	});
});
