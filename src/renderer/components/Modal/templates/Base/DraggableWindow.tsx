import {
    forwardRef,
    ReactNode,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import "./DraggableWindow.scss";

interface IProps {
    children: ReactNode;
    className?: string;
    defaultWidth?: number;
    defaultHeight?: number;
    minWidth?: number;
    minHeight?: number;
    /** 最大化状态变化时通知外面，用来切图标 */
    onMaximizeChange?: (maximized: boolean) => void;
    /** 收起状态变化时通知外面，用来暂停视频之类的 */
    onCollapsedChange?: (collapsed: boolean) => void;
    /** 收起时窗口的宽度 */
    collapsedWidth?: number;
}

/** 外面能操作窗口的接口 */
export interface IDraggableWindowHandle {
    toggleMaximize: () => void;
    toggleCollapsed: () => void;
}

interface IBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** 拖动时至少留这么多在屏幕里，别把窗口整个拖出去找不着 */
const KEEP_ON_SCREEN = 80;

/** 收起后只留标题栏，高度与标题栏一致 */
const COLLAPSED_HEIGHT = 48;

const DraggableWindow = forwardRef<IDraggableWindowHandle, IProps>(
    function DraggableWindow(props, ref) {
        const {
            children,
            className,
            defaultWidth = 880,
            defaultHeight = 580,
            minWidth = 360,
            minHeight = 240,
            onMaximizeChange,
            onCollapsedChange,
            collapsedWidth = 320,
        } = props;

        const boxRef = useRef<HTMLDivElement>(null);
        const dragRef = useRef<{
            pointerId: number;
            offsetX: number;
            offsetY: number;
        } | null>(null);
        const resizeRef = useRef<{
            pointerId: number;
            startX: number;
            startY: number;
            width: number;
            height: number;
        } | null>(null);
        /** 最大化前的窗口位置，还原时用 */
        const restoreBoxRef = useRef<IBox | null>(null);
        /** 收起前的窗口位置，展开时用 */
        const collapsedRestoreRef = useRef<{
            box: IBox;
            maximized: boolean;
        } | null>(null);
        const maximizedRef = useRef(false);
        const collapsedRef = useRef(false);
        const boxStateRef = useRef<IBox | null>(null);

        const [box, setBox] = useState<IBox>(() => {
            const w = Math.min(defaultWidth, Math.floor(window.innerWidth * 0.86));
            const h = Math.min(defaultHeight, Math.floor(window.innerHeight * 0.86));
            return {
                w,
                h,
                x: Math.max(0, Math.floor((window.innerWidth - w) / 2)),
                y: Math.max(0, Math.floor((window.innerHeight - h) / 2)),
            };
        });
        const [maximized, setMaximized] = useState(false);
        const [collapsed, setCollapsed] = useState(false);

        useEffect(() => {
            boxStateRef.current = box;
        }, [box]);

        const clampPosition = (next: IBox): IBox => ({
            ...next,
            x: Math.min(
                Math.max(0, next.x),
                Math.max(0, window.innerWidth - KEEP_ON_SCREEN),
            ),
            y: Math.min(
                Math.max(0, next.y),
                Math.max(0, window.innerHeight - KEEP_ON_SCREEN),
            ),
        });

        const toggleMaximize = useCallback(() => {
            const next = !maximizedRef.current;
            maximizedRef.current = next;
            setMaximized(next);
            if (next) {
                restoreBoxRef.current = boxStateRef.current;
                setBox({
                    x: 0,
                    y: 0,
                    w: window.innerWidth,
                    h: window.innerHeight,
                });
            } else {
                const restore = restoreBoxRef.current;
                restoreBoxRef.current = null;
                if (restore) {
                    setBox(restore);
                }
            }
            onMaximizeChange?.(next);
        }, [onMaximizeChange]);

        /** 收起到右下角的一条，展开时恢复原来的尺寸与位置 */
        const toggleCollapsed = useCallback(() => {
            const next = !collapsedRef.current;
            collapsedRef.current = next;
            setCollapsed(next);
            if (next) {
                collapsedRestoreRef.current = {
                    box: boxStateRef.current as IBox,
                    maximized: maximizedRef.current,
                };
                const width = Math.min(
                    collapsedWidth,
                    Math.floor(window.innerWidth - 32),
                );
                setBox({
                    x: Math.max(0, window.innerWidth - width - 16),
                    y: Math.max(0, window.innerHeight - COLLAPSED_HEIGHT - 16),
                    w: width,
                    h: COLLAPSED_HEIGHT,
                });
                // 收起时先退出最大化，展开时再回到最大化
                if (maximizedRef.current) {
                    maximizedRef.current = false;
                    setMaximized(false);
                    onMaximizeChange?.(false);
                }
            } else {
                const restore = collapsedRestoreRef.current;
                collapsedRestoreRef.current = null;
                if (restore) {
                    if (restore.maximized) {
                        maximizedRef.current = true;
                        setMaximized(true);
                        onMaximizeChange?.(true);
                        setBox({
                            x: 0,
                            y: 0,
                            w: window.innerWidth,
                            h: window.innerHeight,
                        });
                    } else {
                        setBox(restore.box);
                    }
                }
            }
            onCollapsedChange?.(next);
        }, [collapsedWidth, onCollapsedChange, onMaximizeChange]);

        useImperativeHandle(
            ref,
            () => ({ toggleMaximize, toggleCollapsed }),
            [toggleMaximize, toggleCollapsed],
        );

        // 应用窗口本身变了尺寸，之前摆的位置可能跑到屏幕外
        useEffect(() => {
            const onWindowResize = () => {
                if (maximizedRef.current) {
                    setBox({
                        x: 0,
                        y: 0,
                        w: window.innerWidth,
                        h: window.innerHeight,
                    });
                    return;
                }
                setBox((prev) => clampPosition(prev));
            };
            window.addEventListener("resize", onWindowResize);
            return () => {
                window.removeEventListener("resize", onWindowResize);
            };
        }, []);

        function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
            if (maximizedRef.current) {
                return;
            }
            const target = e.target as HTMLElement;
            // 只有标题栏能拖动，关闭按钮除外
            const header = target.closest(".components--modal-base-header");
            if (!header) {
                return;
            }
            if (target.closest(".components--modal-base-header-close")) {
                return;
            }
            // 标题栏里的输入框与按钮有自己的交互，不能被拖动抢走。
            // 只能看标题栏内部：遮罩本身是 role="button"，它是标题栏的祖先，不能算
            let node: HTMLElement | null = target;
            while (node && node !== header) {
                if (
                    node.matches(
                        "input, textarea, select, button, [role='button']",
                    )
                ) {
                    return;
                }
                node = node.parentElement;
            }
            const rect = boxRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            dragRef.current = {
                pointerId: e.pointerId,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        }

        function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) {
                return;
            }
            setBox((prev) =>
                clampPosition({
                    ...prev,
                    x: e.clientX - drag.offsetX,
                    y: e.clientY - drag.offsetY,
                }),
            );
        }

        function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
            if (dragRef.current?.pointerId === e.pointerId) {
                dragRef.current = null;
                e.currentTarget.releasePointerCapture?.(e.pointerId);
            }
        }

        function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
            e.stopPropagation();
            resizeRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                width: box.w,
                height: box.h,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        }

        function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
            const resize = resizeRef.current;
            if (!resize || resize.pointerId !== e.pointerId) {
                return;
            }
            const maxWidth = Math.max(minWidth, window.innerWidth - 40);
            const maxHeight = Math.max(minHeight, window.innerHeight - 40);
            setBox((prev) => ({
                ...prev,
                w: Math.min(
                    maxWidth,
                    Math.max(minWidth, resize.width + (e.clientX - resize.startX)),
                ),
                h: Math.min(
                    maxHeight,
                    Math.max(minHeight, resize.height + (e.clientY - resize.startY)),
                ),
            }));
        }

        function onResizePointerUp(e: React.PointerEvent<HTMLDivElement>) {
            if (resizeRef.current?.pointerId === e.pointerId) {
                resizeRef.current = null;
                e.currentTarget.releasePointerCapture?.(e.pointerId);
            }
        }

        return (
            <div
                ref={boxRef}
                className={`components--draggable-window ${
                    collapsed ? "components--draggable-window--collapsed" : ""
                } ${className ?? ""}`}
                style={{
                    width: box.w,
                    height: box.h,
                    transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {children}
                {maximized || collapsed ? null : (
                    <div
                        className="components--draggable-window-resize"
                        onPointerDown={onResizePointerDown}
                        onPointerMove={onResizePointerMove}
                        onPointerUp={onResizePointerUp}
                        onPointerCancel={onResizePointerUp}
                    ></div>
                )}
            </div>
        );
    },
);

export default DraggableWindow;
