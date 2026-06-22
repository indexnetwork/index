import { createContext, useContext, ReactNode } from "react";

const SaveBarContext = createContext<boolean>(false);

export function SaveBarProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <SaveBarContext.Provider value={visible}>{children}</SaveBarContext.Provider>
  );
}

export function useSaveBarVisible() {
  return useContext(SaveBarContext);
}
