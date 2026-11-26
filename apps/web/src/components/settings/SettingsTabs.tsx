import { useNavigate } from "react-router";

import { SETTINGS_TABS, settingsPath, type SettingsTab } from "@/lib/settings-tabs";

/** Account panes in the settings window (outside the app frame). */
export default function SettingsTabs({ active }: { active: SettingsTab }) {
  const navigate = useNavigate();
  return (
    <div className="wb-segmented lg" role="tablist">
      {SETTINGS_TABS.map((tab) => (
        <button key={tab} type="button" role="tab" aria-pressed={tab === active} onClick={() => navigate(settingsPath(tab))}>
          {tab}
        </button>
      ))}
    </div>
  );
}
