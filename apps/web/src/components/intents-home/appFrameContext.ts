import { createContext, useContext } from "react";

/** True inside the signed-in desktop shell, which already draws the page's window and title. */
export const InAppFrameContext = createContext(false);

export const useInAppFrame = () => useContext(InAppFrameContext);

/**
 * Where a page can put its own window on the right of the shell, beside the
 * page (e.g. Introduce's running list or a picked person). Null outside the shell.
 */
export const RightSlotContext = createContext<HTMLElement | null>(null);

export const useRightSlot = () => useContext(RightSlotContext);
