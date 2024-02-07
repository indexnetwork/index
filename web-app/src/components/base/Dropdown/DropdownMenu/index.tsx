import React, { forwardRef, ReactElement } from "react";
import cc from "classcat";
import { DropdownMenuItemProps } from "../DropdownMenuItem";

export interface DropdownMenuProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLUListElement>,
    HTMLUListElement
  > {
  children:
    | ReactElement<DropdownMenuItemProps>
    | ReactElement<DropdownMenuItemProps>[];
}

const DropdownMenu: React.ForwardRefRenderFunction<
  HTMLUListElement,
  DropdownMenuProps
> = (props, ref) => (
  <ul ref={ref} className={cc(["dropdown-menu", props.className || ""])}>
    {props.children}
  </ul>
);

export default forwardRef(DropdownMenu);
