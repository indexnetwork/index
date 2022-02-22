import DndList from "components/base/DndList";
import React, { useState } from "react";
import IndexDetailsListItem from "./IndexDetailListItem";

export interface LinkListProps { }

const IndexDetailsList: React.VFC<LinkListProps> = () => {
	const [items, setItems] = useState(["deneme", "deneme2", "deneme3", "denem221e", "deneme23", "deneme32"]);

	return (
		<DndList
			data={items}
			listClass="index-detail-list"
			draggable
			render={(item, index, provided) => <IndexDetailsListItem title={item as string} provided={provided!}/>}
			divided
		/>
	);
};

export default IndexDetailsList;
