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
}

const Dropdown: React.FC<DropdownProps> = ({
	menuItems,
	children,
	dropdownClass,
	...popupProps
}) => (
	<Popup
		{...popupProps}
		popupClass={cc(["idx-dropdown", dropdownClass || ""])}
		content={<DropdownMenu>{menuItems}</DropdownMenu>}
	>
		{children}
	</Popup>
);

export default Dropdown;
