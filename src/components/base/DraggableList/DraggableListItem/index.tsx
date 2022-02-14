import React, { forwardRef, ForwardRefRenderFunction, PropsWithChildren } from "react";
import cc from "classcat";

export interface DraggableListItemProps {
	className?: string;
	containerId: string;
	order: number;
	onPositionChanged?(containerId: string, draggedItemOrder: number, newOrder: number): void;
}

const DraggableListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<DraggableListItemProps>> = ({
	children,
	className,
	containerId,
	order,
	onPositionChanged,
}, ref) => {
	const handleDragStart = (e: any) => {
		e.dataTransfer.setData("idxContainerId", containerId);
		e.dataTransfer.setData("idxDraggedItemOrder", order);
	};

	const handleDrop = (e: any) => {
		const idxContainerId = e.dataTransfer.getData("idxContainerId");
		const idxDraggedItemOrder = e.dataTransfer.getData("idxDraggedItemOrder");
		if (
			!idxContainerId ||
			idxContainerId !== containerId ||
			!idxDraggedItemOrder
		) {
			return;
		}
		onPositionChanged && onPositionChanged(containerId, parseInt(idxDraggedItemOrder), order);
	};

	return (
		<li
			ref={ref}
			draggable
			className={cc(
				[
					"idx-draggable-list-item",
					className || "",
				],
			)
			}
			onDragOver={(e) => e.preventDefault()}
			onDragStart={handleDragStart}
			onDrop={handleDrop}
		>
			{children}
		</li>
	);
};

export default forwardRef(DraggableListItem);
