import React, {
	ReactElement, useEffect, useRef, useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import ListItem from "./ListItem";

export interface ListProps<T = {}> {
	data: T[];
	listClass?: string;
	itemContainerClass?: string;
	render(item: T, index: number): ReactElement<any>;
	divided?: boolean;
}

const List: React.VFC<ListProps> = ({
	data,
	listClass,
	itemContainerClass,
	render,
	divided = true,
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
				listData.map((item, index) => (
					<ListItem
						key={`listItem${index}-${containerId}`}
						className={cc([
							itemContainerClass || "",
						])}
					>
						{render(item, index)}
						{divided && index !== listData.length - 1 && <div className="idx-list-divider"></div>}
					</ListItem>
				))
			}
		</ul>
	);
};

export default List;
