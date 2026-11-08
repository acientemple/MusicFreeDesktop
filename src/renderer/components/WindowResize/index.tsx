/**
 * 渲染进程侧的窗口缩放：
 *
 * 无边框窗口在 Windows 上没有系统缩放边框，窗口四周放一圈感应条，
 * 按下之后由这里算出新的窗口边界，交给主进程去设置。
 * 用指针捕获，保证鼠标拖到窗口外面时也还能继续拖。
 */

import { useEffect, useRef } from "react";
import {
    calculateResizeBounds,
    IResizeDirection,
    IWindowBounds,
} from "@/common/window-resize-util";
import "./index.scss";

interface IMod {
    getWindowBounds(): Promise<IWindowBounds | null>;
    setWindowBounds(bounds: IWindowBounds): void;
}

const mod = window["@shared/window-resize" as any] as unknown as IMod;

const directions: IResizeDirection[] = [
    "n",
    "s",
    "e",
    "w",
    "ne",
    "nw",
    "se",
    "sw",
];

interface IResizeSession {
    direction: IResizeDirection;
    /** 按下时的鼠标位置（屏幕坐标） */
    startScreenX: number;
    startScreenY: number;
    /** 按下时的窗口边界 */
    bounds: IWindowBounds;
    /** 捕获指针的元素，松开时要释放 */
    element: HTMLElement | null;
    pointerId: number;
}

export default function WindowResizeHandles() {
    const sessionRef = useRef<IResizeSession | null>(null);
    /** 等待主进程返回窗口边界时用 */
    const pendingRef = useRef<{
        direction: IResizeDirection;
        screenX: number;
        screenY: number;
    } | null>(null);

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => {
            const session = sessionRef.current;
            if (!session) {
                return;
            }
            const dx = e.screenX - session.startScreenX;
            const dy = e.screenY - session.startScreenY;
            mod.setWindowBounds(
                calculateResizeBounds(
                    session.bounds,
                    session.direction,
                    dx,
                    dy,
                ),
            );
        };

        const stopResize = () => {
            const session = sessionRef.current;
            if (!session) {
                return;
            }
            sessionRef.current = null;
            pendingRef.current = null;
            // 释放指针捕获，免得下次按下时状态不对
            try {
                if (session.element?.hasPointerCapture(session.pointerId)) {
                    session.element.releasePointerCapture(session.pointerId);
                }
            } catch {
                // 忽略
            }
            document.body.classList.remove("window-resizing");
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stopResize);
        window.addEventListener("pointercancel", stopResize);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", stopResize);
            window.removeEventListener("pointercancel", stopResize);
        };
    }, []);

    const onPointerDown = async (
        e: React.PointerEvent<HTMLDivElement>,
        direction: IResizeDirection,
    ) => {
        // 防止选中文字、防止拖到一半窗口失焦
        e.preventDefault();
        e.stopPropagation();
        document.body.classList.add("window-resizing");
        // 先捕获指针：鼠标拖到窗口外面时，事件还是会继续送到这里
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // 忽略
        }
        pendingRef.current = {
            direction,
            screenX: e.screenX,
            screenY: e.screenY,
        };
        const bounds = await mod.getWindowBounds();
        const pending = pendingRef.current;
        if (!pending || !bounds) {
            pendingRef.current = null;
            document.body.classList.remove("window-resizing");
            return;
        }
        sessionRef.current = {
            direction: pending.direction,
            startScreenX: pending.screenX,
            startScreenY: pending.screenY,
            bounds,
            element: e.currentTarget,
            pointerId: e.pointerId,
        };
    };

    return (
        <>
            {directions.map((direction) => (
                <div
                    key={direction}
                    className={`window-resize-handle window-resize-handle-${direction}`}
                    onPointerDown={(e) => {
                        onPointerDown(e, direction);
                    }}
                ></div>
            ))}
        </>
    );
}
