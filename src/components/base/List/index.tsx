import React, {
	ReactElement, useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import { Draggable, DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";
import { useLinks } from "hooks/useLinks";
import ListItem from "./ListItem";

export interface ListProps<T = {}> {
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number, provided?: DraggableProvided, snapshot?: DraggableStateSnapshot): ReactElement<any>;
	divided?: boolean;
	draggable?: boolean;
	placeholder?: any;
	droppableProvided?: any,
}

const List: React.VFC<ListProps> = ({
	listClass,
	itemContainerClass,
	render,
	divided = true,
	draggable = false,
	placeholder,
	droppableProvided,
}) => {
	const containerId = useRef<string>(uuidv4());
	const { links } = useLinks();
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
				links.map((item, index) => (!draggable ? (
					<ListItem
						key={`listItem${index}-${containerId}`}
						className={cc([
							itemContainerClass || "",
						])}
					>
						{render(item, index)}
						{divided && index !== links.length - 1 && <div className="list-divider"></div>}
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
							{divided && index !== links.length - 1 && <div className="list-divider"></div>}
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
