import React, {
	forwardRef, ForwardRefRenderFunction, PropsWithChildren,
} from "react";
import cc from "classcat";

export interface ListItemProps {
	className?: string;
}

const ListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<ListItemProps>> = ({
	children,
	className,
}, ref) => (
	<li
		ref={ref}
		draggable
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
