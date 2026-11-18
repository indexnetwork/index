import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { StatusPage } from "@/components/SiteSignIn";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <StatusPage bar={t("not found")} title={t("Page not found")} message={t("That page isn’t here.")}>
      <Link className="site-btn" to="/">{t("Go home")}</Link>
    </StatusPage>
  );
}

export const Component = NotFound;
