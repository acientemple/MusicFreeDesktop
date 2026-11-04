import { compare } from "compare-versions";
import { showModal } from "../components/Modal";
import { getUserPreference } from "./user-perference";
import { appUtil } from "@shared/utils/renderer";

export default async function checkUpdate(forceCheck?: boolean) {
    /** checkupdate */
    const updateInfo = await appUtil.checkUpdate();
    if (updateInfo.update) {
        const skipVersion = getUserPreference("skipVersion");
        if (!forceCheck && skipVersion) {
            let skipped = false;
            try {
                // 比对的是新版本，不是当前版本
                skipped = compare(
                    updateInfo.update.version,
                    skipVersion,
                    "<=",
                );
            } catch {
                skipped = false;
            }
            if (skipped) {
                return false;
            }
        }
        showModal("Update", {
            currentVersion: updateInfo.version,
            update: updateInfo.update,
        });
        return true;
    }
    return false;
}
