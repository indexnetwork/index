import { useLocation, useSearchParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

const TABS = [
  { key: "agents", label: "agents", to: "/settings?tab=agents" },
  { key: "notifications", label: "notifications", to: "/settings" },
  { key: "access", label: "access", to: "/settings?tab=access" },
  { key: "advanced", label: "advanced", to: "/settings?tab=advanced" },
] as const;

/** Account panes. The profile and agents are their own screens. */
export default function SettingsTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  if (pathname.startsWith("/agents")) return null;
  const tab = searchParams.get("tab");
  const active = tab === "agents" || tab === "access" || tab === "advanced" ? tab : "notifications";

  return (
    <div className="wb-segmented lg" role="tablist">
      {TABS.map(({ key, label, to }) => (
        <button key={key} type="button" role="tab" aria-pressed={key === active} onClick={() => navigate(to)}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}
