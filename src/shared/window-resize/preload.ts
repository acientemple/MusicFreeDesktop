import { contextBridge, ipcRenderer } from "electron";
import {
    IResizeDirection,
    IWindowBounds,
} from "@/common/window-resize-util";

/** 取当前窗口边界 */
function getWindowBounds(): Promise<IWindowBounds | null> {
    return ipcRenderer.invoke("@shared/window-resize/get-bounds");
}

/** 设置窗口边界 */
function setWindowBounds(bounds: IWindowBounds) {
    ipcRenderer.send("@shared/window-resize/set-bounds", bounds);
}

const mod = {
    getWindowBounds,
    setWindowBounds,
};

contextBridge.exposeInMainWorld("@shared/window-resize", mod);

export type { IResizeDirection };
