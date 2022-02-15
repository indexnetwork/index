import React, {
	ReactElement, useCallback, useEffect, useRef, useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import { useMergedState } from "hooks/useMergedState";
import DraggableListItem from "./DraggableListItem";

export interface IndexedDraggableListData<T = {}> {
	data: T;
}

export interface DraggableListProps<T = {}> {
	data: T[];
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number): ReactElement<any>;
	divided?: boolean;
}

const DraggableList: React.VFC<DraggableListProps> = ({
	data,
	listClass,
	itemContainerClass,
	render,
	divided = true,
}) => {
	const [listData, setListData] = useState(data);
	const containerId = useRef<string>(uuidv4());
	const [dragState, setDragState] = useMergedState<{
		oldOrder?: number;
		currentOrder?: number;
		dragging: boolean;
	}>({
		dragging: false,
	});

	useEffect(() => {
		setListData(data);
	}, [data]);

	const reorderItems = (oldOrder: number, newOrder: number) => {
		if (oldOrder !== newOrder) {
			setListData((oldListData) => {
				const tempListData = [...oldListData];
				const draggedItem = tempListData[oldOrder];
				tempListData.splice(oldOrder, 1);
				tempListData.splice(newOrder, 0, draggedItem);
				return tempListData;
			});
			setDragState({ currentOrder: newOrder });
		}
	};

	// const handlePositionChange = useCallback((cId: string, draggedItemOrder: number, newOrder: number) => {
	// 	reorderItems(draggedItemOrder, newOrder);
	// }, []);

	const handleDragStart = useCallback((cId: string, oldOrder: number) => {
		setDragState({ oldOrder, currentOrder: oldOrder, dragging: true });
	}, []);

	const handleDragOver = useCallback((newOrder: number) => {
		if (dragState.currentOrder !== newOrder) {
			reorderItems(dragState.currentOrder!, newOrder);
		}
	}, [dragState]);

	const handleDrop = useCallback(() => {
		setDragState({
			dragging: false,
		});
	}, []);

	return (
		<ul className={
			cc([
				"idx-draggable-list",
				dragState.dragging ? "idx-draggable-list-dragging" : "",
				listClass || "",
			])
		}>
			{
				listData.map((item, index) => (
					<DraggableListItem
						key={`draggableItem${index}`}
						className={cc([
							itemContainerClass || "",
						])}
						containerId={containerId.current}
						order={index}
						dragging={dragState.dragging && dragState.currentOrder === index}
						// onPositionChanged={handlePositionChange}
						onDragStart={handleDragStart}
						onDragStop={handleDragOver}
						onDrop={handleDrop}
					>
						{render(item, index)}
						{divided && index !== listData.length - 1 && <div className="idx-draggable-list-divider"></div>}
					</DraggableListItem>
				))
			}
		</ul>
	);
};

export default DraggableList;
