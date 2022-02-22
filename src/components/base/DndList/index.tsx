import React, { useState } from "react";

import {
	DragDropContext, Droppable, DropResult, ResponderProvided,
} from "react-beautiful-dnd";
import { isSSR } from "utils/helper";
import List, { ListProps } from "../List";

export interface DndListProps extends ListProps {}

const DndList: React.VFC<DndListProps> = (listProps) => {
	const [items, setItems] = useState(["deneme", "deneme2", "deneme3"]);

	if (isSSR()) {
		// TODO: If SSR return plain list
		return null;
	}

	const handleOnDragEnd = (result: DropResult, provided: ResponderProvided) => {

	};

	return (
		<DragDropContext onDragEnd={handleOnDragEnd}>
			<Droppable
				droppableId="droppable"
			>
				{(dropppableProvided) => (
					<>
						<div
							ref={dropppableProvided.innerRef}
							{...dropppableProvided.droppableProps}
						>
							<List
								{...listProps}
							/>
						</div>
					</>
				)}
			</Droppable>
		</DragDropContext>
	);
};

export default DndList;
