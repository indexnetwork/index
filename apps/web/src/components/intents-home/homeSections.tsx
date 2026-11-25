import { useState, type ReactNode } from "react";

import { SectionsContext, SetSectionsContext, type HomeSection } from "@/components/intents-home/homeSectionsContext";

/** Lets Home tell the sidebar which sections it has, so the sidebar can link straight to them. */
export function HomeSectionsProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<HomeSection[]>([]);
  return (
    <SetSectionsContext.Provider value={setSections}>
      <SectionsContext.Provider value={sections}>{children}</SectionsContext.Provider>
    </SetSectionsContext.Provider>
  );
}
