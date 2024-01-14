import React, {
	ReactElement,
} from "react";
import cc from "classcat";
import { DropdownMenuItemProps } from "./DropdownMenuItem";
import Popup, { PopupProps } from "../Popup";
import DropdownMenu from "./DropdownMenu";

export interface DropdownProps extends Omit<PopupProps, "content" | "popupClass"> {
	dropdownClass?: string;
	menuItems: ReactElement<DropdownMenuItemProps> | ReactElement<DropdownMenuItemProps>[];
	children: React.ReactNode;
}

const Dropdown = (
	{
		menuItems,
		children,
		dropdownClass,
		...popupProps
	}: DropdownProps,
) => (<Popup
	{...popupProps}
	popupClass={cc(["dropdown", dropdownClass || ""])}
	content={<DropdownMenu>{menuItems}</DropdownMenu>}
>
	{children}
</Popup>);

export default Dropdown;
