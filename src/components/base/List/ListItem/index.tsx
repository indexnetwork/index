import React, {
	forwardRef, ForwardRefRenderFunction, PropsWithChildren,
} from "react";
import cc from "classcat";
import { DraggableProvided } from "react-beautiful-dnd";

export interface ListItemProps {
	className?: string;
	provided?: DraggableProvided;
}

const ListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<ListItemProps>> = ({
	children,
	className,
	provided,
}, ref) => (
	<li
		ref={provided ? provided.innerRef : ref}
		{...(provided ? provided.draggableProps : undefined)}
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
