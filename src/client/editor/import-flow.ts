/**
 * Import flow — quick tutorial overlay, disposable.
 * No submit/bake here — that lives in the sidebar.
 */
const importSection = document.getElementById("import-section");
const closeBtn = document.getElementById("import-close-btn");
const prevBtn = document.getElementById("import-prev-btn");
const nextBtn = document.getElementById("import-next-btn");

const TOTAL_STEPS = 5;
let currentStep = 0;

export function initImportFlow(): void {
	if (!importSection) return;
	if (closeBtn) closeBtn.addEventListener("click", () => dismiss());

	// Click step indicators to jump
	const stepClicks = document.querySelectorAll(".import-step[data-step]");
	stepClicks.forEach((el) => {
		el.addEventListener("click", () => {
			const target = parseInt((el as HTMLElement).dataset.step ?? "0", 10);
			goStep(target);
		});
	});

	// Always show tutorial on startup
	goStep(0);
}

function updateNav() {
	if (prevBtn) prevBtn.style.display = currentStep > 0 ? "inline-block" : "none";
	if (nextBtn) {
		if (currentStep >= TOTAL_STEPS - 1) {
			nextBtn.textContent = "Got it ✓";
		} else {
			nextBtn.textContent = "Next →";
		}
	}
}

function goStep(step: number) {
	step = Math.max(0, Math.min(step, TOTAL_STEPS - 1));
	currentStep = step;

	const importSteps = document.querySelectorAll(".import-step");
	importSteps.forEach((el, i) => {
		(el as HTMLElement).classList.toggle("active", i === step);
		(el as HTMLElement).classList.toggle("done", i < step);
		(el as HTMLElement).style.cursor = "pointer";
	});

	const panels = document.querySelectorAll(".import-panel");
	panels.forEach((el) => {
		const panelStep = parseInt((el as HTMLElement).dataset.panel ?? "-1", 10);
		(el as HTMLElement).style.display = panelStep === step ? "block" : "none";
	});

	updateNav();
}

// Wire nav buttons once — goStep handles all state, no double-fire
if (prevBtn) prevBtn.addEventListener("click", () => goStep(currentStep - 1));
if (nextBtn)
	nextBtn.addEventListener("click", () => {
		if (currentStep >= TOTAL_STEPS - 1) dismiss();
		else goStep(currentStep + 1);
	});

/** Dismiss the tutorial. */
export function dismiss(): void {
	sessionStorage.setItem("editor-tutorial-seen", "1");
	if (importSection) importSection.style.display = "none";
}

/** Show the tutorial again. */
export function show(): void {
	if (importSection) {
		importSection.style.display = "block";
		goStep(0);
	}
}
