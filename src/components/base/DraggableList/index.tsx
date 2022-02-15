import React, {
	ReactElement, useCallback, useEffect, useRef, useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import DraggableListItem from "./DraggableListItem";

export interface IndexedDraggableListData<T = {}> {
	data: T;
}

export interface DraggableListProps<T = {}> {
	data: T[];
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number): ReactElement<any>;
}

const DraggableList: React.VFC<DraggableListProps> = ({
	data,
	listClass,
	itemContainerClass,
	render,
}) => {
	const [listData, setListData] = useState(data);
	const containerId = useRef<string>(uuidv4());
	const [draggedOrder, setDraggedOrder] = useState<number>();

	useEffect(() => {
		setListData(data);
	}, [data]);

	const reorderItems = (draggedItemOrder: number, newOrder: number) => {
		setListData((oldListData) => {
			const tempListData = [...oldListData];
			const draggedItem = tempListData[draggedItemOrder];
			tempListData.splice(draggedItemOrder, 1);
			tempListData.splice(newOrder, 0, draggedItem);
			return tempListData;
		});
		setDraggedOrder(newOrder);
	};

	// const handlePositionChange = useCallback((cId: string, draggedItemOrder: number, newOrder: number) => {
	// 	reorderItems(draggedItemOrder, newOrder);
	// }, []);

	const handleDragStart = useCallback((cId: string, draggedItemOrder: number) => {
		setDraggedOrder(draggedItemOrder);
	}, []);

	const handleDragOver = useCallback((newOrder: number) => {
		reorderItems(draggedOrder!, newOrder);
	}, [draggedOrder]);

	const handleDrop = useCallback(() => {
		setDraggedOrder(undefined);
	}, []);

	return (
		<ul className={
			cc([
				"idx-draggable-list",
				draggedOrder ? "idx-draggable-list-dragging" : "",
				listClass || "",
			])
		}>
			{
				listData.map((item, index) => (
					<DraggableListItem
						key={`draggableItem${index}`}
						className={draggedOrder !== undefined && draggedOrder === index ? "idx-draggable-drag-active" : ""}
						containerId={containerId.current}
						order={index}
						// onPositionChanged={handlePositionChange}
						onDragStart={handleDragStart}
						onDragLeave={handleDragOver}
						onDrop={handleDrop}
					>
						{render(item, index)}
					</DraggableListItem>
				))
			}
		</ul>
	);
};

export default DraggableList;
