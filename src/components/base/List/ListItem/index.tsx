import React, { PropsWithChildren } from "react";
import cc from "classcat";
import { DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";

export interface ListItemProps {
	className?: string;
	provided?: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
}

const ListItem: React.FC<PropsWithChildren<ListItemProps>> = ({
	children,
	className,
	provided,
}) => (
	<li
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
	</li>
);

export default ListItem;
