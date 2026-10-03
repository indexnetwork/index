import { useLocation, useSearchParams, useNavigate } from "react-router";

const TABS = [
  { key: "profile", label: "profile", to: "/settings" },
  { key: "notifications", label: "notifications", to: "/settings?tab=notifications" },
  { key: "access", label: "access", to: "/settings?tab=access" },
] as const;

/** Account panes. Agents is its own screen, reached from the hub. */
export default function SettingsTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  if (pathname.startsWith("/agents")) return null;
  const tab = searchParams.get("tab");
  const active = tab === "notifications" || tab === "access" ? tab : "profile";

  return (
    <div className="wb-segmented lg" role="tablist">
      {TABS.map(({ key, label, to }) => (
        <button key={key} type="button" role="tab" aria-pressed={key === active} onClick={() => navigate(to)}>
          {label}
        </button>
      ))}
    </div>
  );
}
