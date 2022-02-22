import React, {
	ReactElement, useEffect, useRef, useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import { Draggable, DraggableProvided } from "react-beautiful-dnd";
import ListItem from "./ListItem";

export interface ListProps<T = {}> {
	data: T[];
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number, provided?: DraggableProvided): ReactElement<any>;
	divided?: boolean;
	draggable?: boolean;
}

const List: React.VFC<ListProps> = ({
	data,
	listClass,
	itemContainerClass,
	render,
	divided = true,
	draggable = false,
}) => {
	const [listData, setListData] = useState(data);
	const containerId = useRef<string>(uuidv4());

	useEffect(() => {
		setListData(data);
	}, [data]);

	return (
		<ul className={
			cc([
				"idx-list",
				listClass || "",
			])
		}>
			{
				listData.map((item, index) => (!draggable ? (
					<ListItem
						key={`listItem${index}-${containerId}`}
						className={cc([
							itemContainerClass || "",
						])}
					>
						{render(item, index)}
						{divided && index !== listData.length - 1 && <div className="idx-list-divider"></div>}
					</ListItem>
				) : (
					<Draggable
						key={`draggable-${item}`}
						index={index}
						draggableId={`draggable-${item}`}>{(provided) => <ListItem
							provided={provided}
							key={`listItem${index}-${containerId}`}
							className={cc([
								itemContainerClass || "",
							])}
						>
							{render(item, index, provided)}
							{divided && index !== listData.length - 1 && <div className="idx-list-divider"></div>}
						</ListItem>}</Draggable>
				)))
			}
		</ul>
	);
};

export default List;
