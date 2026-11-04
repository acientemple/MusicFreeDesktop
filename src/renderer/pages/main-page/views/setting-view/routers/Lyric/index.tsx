import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import "./index.scss";
import ColorPickerSettingItem from "../../components/ColorPickerSettingItem";
import InputSettingItem from "../../components/InputSettingItem";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import FontPickerSettingItem from "../../components/FontPickerSettingItem";
import { IfTruthy } from "@/renderer/components/Condition";
import { useTranslation } from "react-i18next";
import { getGlobalContext } from "@/shared/global-context/renderer";
import { appWindowUtil } from "@shared/utils/renderer";

const numberArray = Array(65)
    .fill(0)
    .map((_, index) => 16 + index);

/** 智能匹配自动应用的匹配度阈值 */
const smartSearchThresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

export default function Lyric() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--lyric-container">
            <IfTruthy condition={getGlobalContext().platform === "darwin"}>
                <CheckBoxSettingItem
                    label={t("settings.lyric.enable_status_bar_lyric")}
                    keyPath="lyric.enableStatusBarLyric"
                ></CheckBoxSettingItem>
            </IfTruthy>
            <CheckBoxSettingItem
                label={t("settings.lyric.enable_desktop_lyric")}
                keyPath="lyric.enableDesktopLyric"
                onChange={(_evt, checked) => {
                    appWindowUtil.setLyricWindow(checked);
                }}
            ></CheckBoxSettingItem>
            {/* <CheckBoxSettingItem
        label="置顶桌面歌词"
        checked={data.alwaysOnTop}
        keyPath="lyric.alwaysOnTop"
      ></CheckBoxSettingItem> */}
            <CheckBoxSettingItem
                label={t("settings.lyric.lock_desktop_lyric")}
                keyPath="lyric.lockLyric"
            ></CheckBoxSettingItem>
            <FontPickerSettingItem
                label={t("settings.lyric.font")}
                keyPath="lyric.fontData"
            ></FontPickerSettingItem>
            <ListBoxSettingItem
                keyPath="lyric.fontSize"
                options={numberArray}
                label={t("settings.lyric.font_size")}
            ></ListBoxSettingItem>
            <ColorPickerSettingItem
                label={t("settings.lyric.font_color")}
                keyPath="lyric.fontColor"
            ></ColorPickerSettingItem>
            <ColorPickerSettingItem
                label={t("settings.lyric.stroke_color")}
                keyPath="lyric.strokeColor"
            ></ColorPickerSettingItem>
            <div className="divider"></div>
            <CheckBoxSettingItem
                label={t("settings.lyric.smart_search")}
                keyPath="lyric.smartSearch.enabled"
            ></CheckBoxSettingItem>
            <ListBoxSettingItem
                label={t("settings.lyric.smart_search_threshold")}
                keyPath="lyric.smartSearch.autoApplyThreshold"
                options={smartSearchThresholds}
                renderItem={(val) => `${Math.round((val as number) * 100)}%`}
            ></ListBoxSettingItem>
            <InputSettingItem
                label={t("settings.lyric.recognition_token")}
                keyPath="lyric.recognition.token"
                type="password"
                trim
                width="100%"
            ></InputSettingItem>
        </div>
    );
}
