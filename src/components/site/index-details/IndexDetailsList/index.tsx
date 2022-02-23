import DndList from "components/base/DndList";
import React, { useState } from "react";
import IndexDetailsItem from "../IndexDetailItem";

export interface LinkListProps { }

const IndexDetailsList: React.VFC<LinkListProps> = () => {
	const [items, setItems] = useState(["deneme", "deneme2", "deneme3", "denem221e", "deneme23", "deneme32"]);

	return (
		<DndList
			data={items}
			listClass="index-detail-list"
			draggable
			render={(item, index, provided, snapshot) => <IndexDetailsItem
				title={item as string}
				provided={provided!}
				snapshot={snapshot!}
			/>}
			divided
		/>
	);
};

export default IndexDetailsList;
