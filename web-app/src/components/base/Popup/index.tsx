import React, {
  forwardRef,
  PropsWithChildren,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import cc from "classcat";
import useBackdropClick from "hooks/useBackdropClick";

export interface PopupProps {
  trigger?: "click" | "hover" | "both";
  position?:
    | "bottom-left"
    | "bottom-right"
    | "bottom-center"
    | "top-left"
    | "top-right"
    | "top-center";
  delay?: number;
  closeOnHoverOut?: boolean;
  menuClass?: string;
  popupClass?: string;
  closeOnMenuClick?: boolean;
  content?: React.ReactNode;
}

export interface PopupHandles {
  close(): void;
}

const Popup: React.ForwardRefRenderFunction<
  PopupHandles,
  PropsWithChildren<PopupProps>
> = (
  {
    children,
    menuClass,
    popupClass,
    trigger = "click",
    position = "bottom-center",
    delay = 500,
    closeOnMenuClick = true,
    closeOnHoverOut = false,
    content,
  },
  ref,
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [visible, setVisible] = useState(false);

  const timeout = useRef<NodeJS.Timeout>();
  const cancelHover = useRef<boolean>();

  const handleMouseEnter = () => {
    timeout.current = setTimeout(() => {
      if (!cancelHover.current) {
        setVisible(true);
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (closeOnHoverOut) {
      if (timeout.current) {
        clearTimeout(timeout.current);
        timeout.current = undefined;
      }
      setVisible(false);
    }
  };

  const handleClick = (e: any) => {
    cancelHover.current = true;
    if (
      !closeOnMenuClick
      && menuRef.current
      && menuRef.current.contains(e.target)
    ) {
      return;
    }
    setVisible((oldVal) => !oldVal);
  };

  const handleClose = () => {
    setVisible(false);
  };

  useBackdropClick(containerRef, handleClose, visible);

  useEffect(() => {
    if (cancelHover.current) {
      timeout.current && clearTimeout(timeout.current);
      cancelHover.current = false;
    }
  }, [visible, cancelHover]);

  useImperativeHandle(ref, () => ({
    close: handleClose,
  }));

  return (
    <div
      ref={containerRef}
      className={cc(["popup", popupClass || ""])}
      onMouseEnter={
        trigger === "both" || trigger === "hover" ? handleMouseEnter : undefined
      }
      onMouseLeave={
        trigger === "both" || trigger === "hover" ? handleMouseLeave : undefined
      }
      onClick={
        trigger === "both" || trigger === "click" ? handleClick : undefined
      }
    >
      {children}
      {visible && (
        <div
          ref={menuRef}
          className={cc([
            "popup-menu",
            `popup-menu-${position}`,
            menuClass || "",
          ])}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default forwardRef(Popup);
