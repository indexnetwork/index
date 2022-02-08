import React, { ReactElement } from "react";
import cc from "classcat";
import { DropdownMenuItemProps } from "../DropdownMenuItem";

export interface DropdownMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLUListElement>, HTMLUListElement> {
	children: ReactElement<DropdownMenuItemProps> | ReactElement<DropdownMenuItemProps>[];
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, className }) => (
	<ul
		className={cc(
			[
				"idx-dropdown-menu",
				className || "",
			],
		)}
	>{children}</ul>
);

export default DropdownMenu;
