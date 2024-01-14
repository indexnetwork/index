import React from "react";
import cc from "classcat";

export interface DropdownMenuItemProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLLIElement>, HTMLLIElement> {
	divider?: boolean;
}

const DropdownMenuItem = (
	{
		children,
		className,
		divider = false,
		...liProps
	}: DropdownMenuItemProps,
) => (<li
	{...liProps}
	className={cc(
		[
			divider ? "dropdown-menu-divider" : "dropdown-menu-item",
			className || "",
		],
	)}
>{children}</li>);

export default DropdownMenuItem;
