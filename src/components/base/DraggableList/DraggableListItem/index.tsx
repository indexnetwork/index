import React, {
	forwardRef, ForwardRefRenderFunction, PropsWithChildren, useState,
} from "react";
import cc from "classcat";

export interface DraggableListItemProps {
	className?: string;
	containerId: string;
	order: number;
	onPositionChanged?(containerId: string, draggedItemOrder: number, newOrder: number): void;
	onDragStart?(containerId: string, draggedItemOrder: number): void;
	onDragLeave?(newOrder: number): void;
	onDrop?(): void;
}

const DraggableListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<DraggableListItemProps>> = ({
	children,
	className,
	containerId,
	order,
	onPositionChanged,
	onDragStart,
	onDragLeave: onDragOver,
	onDrop,
}, ref) => {
	const [cls, setCls] = useState("");

	function handleDragStart(e: any) {
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.dropEffect = "move";
		e.dataTransfer.setData("idxContainerId", containerId);
		e.dataTransfer.setData("idxDraggedItemOrder", order);
		onDragStart && onDragStart(containerId, order);
	}

	const handleDrop = () => {
		// const idxContainerId = e.dataTransfer.getData("idxContainerId");
		// const idxDraggedItemOrder = parseInt(e.dataTransfer.getData("idxDraggedItemOrder"));
		// if (
		// 	!idxContainerId ||
		// 	idxContainerId !== containerId ||
		// 	idxDraggedItemOrder == null ||
		// 	Number.isNaN(idxDraggedItemOrder) ||
		// 	idxDraggedItemOrder === order
		// ) {
		// 	return;
		// }
		// onPositionChanged && onPositionChanged(containerId, idxDraggedItemOrder, order);
		setCls("");
		onDrop && onDrop();
	};

	return (
		<li
			ref={ref}
			draggable
			className={cc(
				[
					"idx-draggable-list-item",
					className || "",
					cls,
				],
			)
			}
			onDragOver={(e) => {
				e.preventDefault();
				setCls("idx-draggable-drag-enter");
			}}
			onDragEnter={() => {
				onDragOver && onDragOver(order);
			}}
			onDragLeave={() => {
				setCls("");
			}}
			onDragStart={handleDragStart}
			onDragEnd={handleDrop}
		>
			{children}
		</li>
	);
};

export default forwardRef(DraggableListItem);
