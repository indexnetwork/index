import { createContext, useContext } from "react";

/** True inside the signed-in desktop shell, which already draws the page's window and title. */
export const InAppFrameContext = createContext(false);

export const useInAppFrame = () => useContext(InAppFrameContext);
