import React, {
	forwardRef, ForwardRefRenderFunction, PropsWithChildren, useEffect, useRef, useState,
} from "react";
import cc from "classcat";
import Flex from "layout/base/Grid/Flex";
import IconDrag from "components/base/Icon/IconDrag";
import { isMobile } from "utils/helper";

export interface DraggableListItemProps {
	className?: string;
	containerId: string;
	order: number;
	dragging: boolean;
	onPositionChanged?(containerId: string, draggedItemOrder: number, newOrder: number): void;
	onDragStart?(containerId: string, draggedItemOrder: number): void;
	onDragStop?(newOrder: number): void;
	onDrop?(): void;
}

const DraggableListItem: ForwardRefRenderFunction<HTMLLIElement, PropsWithChildren<DraggableListItemProps>> = ({
	children,
	className,
	containerId,
	order,
	dragging,
	onPositionChanged,
	onDragStart,
	onDragStop,
	onDrop,
}, ref) => {
	const [cls, setCls] = useState("");
	const [draggable, setDraggable] = useState(false);
	const dragActivatorRef = useRef<HTMLDivElement>(null);
	const [isMobileDevice] = useState(() => isMobile());

	function handleDragStart(e: any) {
		if (!isMobileDevice && !draggable) {
			e.preventDefault();
			return;
		}
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

	const handleMouseDown = (e: any) => {
		if (!isMobileDevice && e && e.target && dragActivatorRef.current!.contains(e.target)) {
			setDraggable(true);
		}
	};

	useEffect(() => {
		if (!dragging) {
			setDraggable(false);
		}
	}, [dragging]);

	return (
		<li
			ref={ref}
			draggable
			className={cc(
				[
					"idx-draggable-list-item",
					dragging ? "idx-draggable-drag-active" : "",
					className || "",
					cls,
				],
			)
			}
			onDragOver={(e) => {
				e.preventDefault();
			}}
			onDragEnter={() => {
				setCls("idx-draggable-drag-enter");

				if (!dragging) {
					onDragStop && onDragStop(order);
				}
			}}
			onDragLeave={() => {
				setCls("");
			}}
			onDragStart={handleDragStart}
			onDragEnd={handleDrop}
			onMouseDown={handleMouseDown}
		>
			{
				!isMobileDevice && <Flex
					ref={dragActivatorRef}
					className="idx-draggable-drag-icon-wrapper"
				>
					<IconDrag className="idx-draggable-drag-icon"
						stroke="#000" fill="#000" />
				</Flex>
			}
			{children}
		</li>
	);
};

export default forwardRef(DraggableListItem);
