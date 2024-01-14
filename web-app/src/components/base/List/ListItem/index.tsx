import React, { PropsWithChildren } from "react";
import cc from "classcat";

export interface ListItemProps {
	className?: string;
}

const ListItem = (
	{
		children,
		className,
	}: PropsWithChildren<ListItemProps>,
) => (<li
	className={cc(
		[
			"list-item",
			className || "",
		],
	)}
>
	{children}
</li>);

export default ListItem;
