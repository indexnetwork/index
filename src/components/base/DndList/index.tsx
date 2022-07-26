import React, { useCallback } from "react";

import {
	DragDropContext, Droppable, DropResult, ResponderProvided,
} from "react-beautiful-dnd";
import { isSSR } from "utils/helper";
import List, { ListProps } from "../List";

export interface DndListProps<T = {}> extends ListProps<T> {
	onOrderChange(result?: {
		source: number;
		destination: number;
	}):void;
}

function DndList<T>({ onOrderChange, ...listProps }: DndListProps<T>) {
	const handleOnDragEnd = useCallback((result: DropResult, provided: ResponderProvided) => {
		if (result.source && result.destination) {
			onOrderChange({
				source: result.source.index,
				destination: result.destination.index,
			});
		}
	}, [onOrderChange]);

	if (isSSR()) {
		// TODO: If SSR return plain list
		return null;
	}

	return (
		<DragDropContext onDragEnd={handleOnDragEnd}>
			<Droppable
				droppableId="droppable"
			>
				{(provided) => (
					<List
						{...listProps}
						placeholder={provided.placeholder}
						droppableProvided={provided}
					/>
				)}
			</Droppable>
		</DragDropContext>
	);
}

export default DndList;
