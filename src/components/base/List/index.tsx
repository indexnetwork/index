import React, {
	ReactElement, useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import { Draggable, DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";
import ListItem from "./ListItem";
import { Links } from "../../../types/entity";

export interface ListProps<T = {}> {
	data: Links[];
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number, provided?: DraggableProvided, snapshot?: DraggableStateSnapshot): ReactElement<any>;
	divided?: boolean;
	draggable?: boolean;
	placeholder?: any;
	droppableProvided?: any,
}

const List: React.VFC<ListProps> = ({
	data= [],
	listClass,
	itemContainerClass,
	render,
	divided = true,
	draggable = false,
	placeholder,
	droppableProvided,
}) => {
	const containerId = useRef<string>(uuidv4());
	return (
		<ul
			ref={droppableProvided?.innerRef}
			{...droppableProvided?.droppableProps}
			className={
				cc([
					"list",
					listClass || "",
				])
			}>
			{
				data.map((item, index) => (!draggable ? (
					<ListItem
						key={`listItem${index}-${containerId}`}
						className={cc([
							itemContainerClass || "",
						])}
					>
						{render(item, index)}
						{divided && index !== data.length - 1 && <div className="list-divider"></div>}
					</ListItem>
				) : (
					<Draggable
						key={(item as any).id}
						index={index}
						draggableId={(item as any).id}>
						{(provided, snapshot) => <ListItem
							provided={provided}
							className={cc([
								itemContainerClass || "",
							])}
						>
							{render(item, index, provided, snapshot)}
							{divided && index !== data.length - 1 && <div className="list-divider"></div>}
						</ListItem>}</Draggable>
				)))
			}
			{
				droppableProvided?.placeholder
			}
		</ul>
	);
};

export default List;
