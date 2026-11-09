import { createContext, useContext, useEffect } from "react";

export interface HomeSection {
  id: string;
  label: string;
  count?: number;
  /** The count is being refreshed: the sidebar shows it loading. */
  loading?: boolean;
}

export const SectionsContext = createContext<HomeSection[]>([]);
export const SetSectionsContext = createContext<(sections: HomeSection[]) => void>(() => {});

export const useHomeSections = () => useContext(SectionsContext);

/** Before Home has drawn once, the sidebar still lists its sections, without counts. */
export const DEFAULT_HOME_SECTIONS: HomeSection[] = [
  { id: "questions", label: "questions" },
  { id: "waiting", label: "waiting on you" },
  { id: "progress", label: "in progress" },
];

/** Publish Home's sections. The last ones stay after leaving Home so the sidebar keeps them. */
export function usePublishHomeSections(sections: HomeSection[]) {
  const set = useContext(SetSectionsContext);
  const key = JSON.stringify(sections);
  useEffect(() => { set(JSON.parse(key) as HomeSection[]); }, [key, set]);
}

/**
 * Scroll a Home section into view. Coming from another page, Home is still
 * mounting, so keep looking for the section for a couple of seconds.
 */
export function jumpTo(id: string, tries = 40) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (tries > 0) window.setTimeout(() => jumpTo(id, tries - 1), 50);
}
