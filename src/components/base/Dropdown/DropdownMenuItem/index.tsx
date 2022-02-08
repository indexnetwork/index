import React from "react";
import cc from "classcat";

export interface DropdownMenuItemProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLLIElement>, HTMLLIElement> {
	divider?: boolean;
}

const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({ children, className, divider = false }) => (
	<li
		className={cc(
			[
				divider ? "idx-dropdown-menu-divider" : "idx-dropdown-menu-item",
				className || "",
			],
		)}
	>{children}</li>
);

export default DropdownMenuItem;
