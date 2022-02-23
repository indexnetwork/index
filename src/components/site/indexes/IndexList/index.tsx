import List from "components/base/List";
import React from "react";
import IndexItem from "../IndexItem";

export interface IndexListProps {
	shared: boolean;
	data?: any[];
}

const IndexList: React.VFC<IndexListProps> = ({ shared, data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }) => (
	<List
		data={data}
		listClass="index-list"
		render={() => <IndexItem shared={shared} />}
		divided
	/>
);

export default IndexList;
