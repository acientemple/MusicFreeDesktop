import AppHeader from "./components/Header";

import "./app.scss";
import MusicBar from "./components/MusicBar";
import { Outlet } from "react-router";
import PanelComponent from "./components/Panel";
import MusicDetail from "@renderer/components/MusicDetail";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { updaterUtil } from "@shared/utils/renderer";

export default function App() {
    const { t } = useTranslation();

    useEffect(() => {
        // 上一次安装（可能是自动更新后重启）的结果
        updaterUtil.getLastResult().then((result) => {
            if (!result) {
                return;
            }
            if (result.startsWith("failed")) {
                toast.error(t("modal.update_result_failed"));
            } else if (result === "success") {
                toast.success(t("modal.update_result_success"));
            }
        });
    }, []);

    return (
        <div className="app-container">
            <AppHeader></AppHeader>
            <div className="body-container">
                <Outlet></Outlet>
                <PanelComponent></PanelComponent>
            </div>
            <MusicDetail></MusicDetail>
            <MusicBar></MusicBar>
        </div>
    );
}
