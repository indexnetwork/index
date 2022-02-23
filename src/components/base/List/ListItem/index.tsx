import React, {
	forwardRef, ForwardRefRenderFunction, PropsWithChildren,
} from "react";
import cc from "classcat";
import { DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";

export interface ListItemProps {
	className?: string;
	provided?: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
}

const ListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<ListItemProps>> = ({
	children,
	className,
	provided,
	snapshot,
}, ref) => (
	<li
		ref={provided ? provided.innerRef : ref}
		{...(provided ? provided.draggableProps : undefined)}
		style={{ ...provided?.draggableProps!.style }}
		className={cc(
			[
				"idx-list-item",
				className || "",
			],
		)}
	>
		{children}
	</li>
);

export default forwardRef(ListItem);
