/**
 * Object panel wiring — connects object panel events to editor modules.
 */
import { getCurrentModel, onSelectionChange, setSelectedObjectUUID } from "./editor-main.js";
import { renameMaterialForBrakeDisc } from "./material-utils.js";
import {
	autoSetupLightMaterial,
	deleteObject as deleteModelObject,
	markObjectAs,
	toggleObjectVisibility,
} from "./object-manager.js";
import { highlightListItem, onObjectDelete, onObjectMark, onObjectSelect, refreshObjectPanel } from "./object-panel.js";

export function initObjectWiring(): void {
	onObjectSelect((uuid) => {
		setSelectedObjectUUID(uuid);
	});
	onSelectionChange((uuid) => highlightListItem(uuid));
	onObjectMark((uuid, type) => {
		const model = getCurrentModel();
		if (!model) return;
		if (type === "_toggleVis") {
			toggleObjectVisibility(model, uuid);
		} else if (type === "headlight" || type === "taillight") {
			const obj = model.getObjectByProperty("uuid", uuid);
			if (!obj) return;
			markObjectAs(model, uuid, type);
			autoSetupLightMaterial(obj, type);
		} else if (type?.startsWith("brake_disc_")) {
			const obj = model.getObjectByProperty("uuid", uuid);
			if (!obj) return;
			markObjectAs(model, uuid, type);
			renameMaterialForBrakeDisc(obj);
		} else {
			markObjectAs(model, uuid, type);
		}
		refreshObjectPanel(model);
	});
	onObjectDelete((uuid) => {
		const model = getCurrentModel();
		if (!model) return;
		deleteModelObject(model, uuid);
		refreshObjectPanel(model);
	});
}
