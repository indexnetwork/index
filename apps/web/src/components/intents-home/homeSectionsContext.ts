import { createContext, useContext, useEffect } from "react";

export interface HomeSection {
  id: string;
  label: string;
  count?: number;
}

export const SectionsContext = createContext<HomeSection[]>([]);
export const SetSectionsContext = createContext<(sections: HomeSection[]) => void>(() => {});

export const useHomeSections = () => useContext(SectionsContext);

/** Publish Home's sections while it is mounted; they clear when Home goes away. */
export function usePublishHomeSections(sections: HomeSection[]) {
  const set = useContext(SetSectionsContext);
  const key = JSON.stringify(sections);
  useEffect(() => { set(JSON.parse(key) as HomeSection[]); }, [key, set]);
  useEffect(() => () => set([]), [set]);
}

/** Scroll a Home section into view. */
export function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
