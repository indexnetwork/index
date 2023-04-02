import React, { PropsWithChildren } from "react";
import cc from "classcat";
import { DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";

export interface ListItemProps {
	className?: string;
	provided?: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
}

const ListItem = (
	{
		children,
		className,
		provided,
	}: PropsWithChildren<ListItemProps>,
) => (<li
	ref={provided?.innerRef}
	{...(provided?.draggableProps)}
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
