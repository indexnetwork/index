import DndList from "components/base/DndList";
import List from "components/base/List";
import { useMergedState } from "hooks/useMergedState";
import React, { useEffect, useState } from "react";
import InfiniteScroll from "react-infinite-scroller";
import api, { LinkSearchResponse } from "services/api-service";
import { Links } from "types/entity";
import { arrayMove } from "utils/helper";
import IndexDetailsItem from "../IndexDetailItem";

export interface LinkListState {
	dt: LinkSearchResponse;
	skip: number;
	take: number;
	search?: string;
	hasMore: boolean;
}
export interface LinkListProps {
	links?: Links[];
	search?: string;
	streamId: string;
	isOwner?: boolean;
	onChange?(links: Links[]): void;
	onFetch?(loading: boolean): void;
}

const MemoIndexDetailsItem = React.memo(IndexDetailsItem);

const IndexDetailsList: React.VFC<LinkListProps> = ({
	links = [],
	search,
	streamId,
	isOwner,
	onChange,
	onFetch,
}) => {
	const [items, setItems] = useState<Links[]>(links);
	const [loading, setLoading] = useState(false);
	const [hasLinks, setHasLinks] = useState(true);
	const [init, setInit] = useState(true);
	const [state, setState] = useMergedState<LinkListState>({
		dt: {
			records: [],
		},
		skip: 0,
		take: 10,
		search,
		hasMore: true,
	});

	const getData = async (page?: number, reset?: boolean, searchT?: string) => {
		setLoading(true);
		const res = await api.searchLink({
			skip: reset ? 0 : state.skip,
			take: state.take,
			streamId,
			search: reset ? searchT! : state.search!,
		});
		if (res) {
			setState((oldState) => ({
				hasMore: res.totalCount! > res.search!.skip! + oldState.take,
				dt: {
					records: reset ? (res.records || []) : [...oldState.dt.records!, ...(res.records ?? [])],
				},
				skip: reset ? oldState.take : oldState.skip + oldState.take,
				search: searchT || oldState.search,
			}));
		}
		setLoading(false);
		if (!init) {
			setHasLinks(!!(res?.records && res.records.length > 0));
			setInit(true);
		}
	};

	useEffect(() => {
		setItems(links);
	}, [links]);

	useEffect(() => {
		getData(undefined, true, search);
	}, [search]);

	useEffect(() => {
		onFetch && onFetch(loading);
	}, [loading]);

	const handleOrderChange = (value: {
		source: number,
		destination: number,
	}) => {
		setItems((oldVal) => {
			const newArray = arrayMove(oldVal, value.source, value.destination);
			onChange && onChange(newArray);
			return newArray;
		});
	};

	const handleLinksChange = (newLinks: Links[]) => {
		setItems(newLinks);
	};

	return (
		<>
			{
				search ? (
					<InfiniteScroll
						initialLoad={false}
						hasMore={state.hasMore}
						loadMore={getData}
						marginHeight={50}
					>
						<List
							data={state.dt?.records || []}
							listClass="index-list"
							render={(item, index, provided, snapshot) => <MemoIndexDetailsItem
								provided={provided!}
								snapshot={snapshot!}
								search={!!search}
								isOwner={isOwner}
								{...item}
								onChange={handleLinksChange}
							/>}
							divided
						/>
					</InfiniteScroll>
				) : (
					<DndList<Links>
						data={items}
						listClass="index-detail-list"
						draggable={isOwner}
						render={(item, index, provided, snapshot) => <MemoIndexDetailsItem
							provided={provided!}
							isOwner={isOwner}
							snapshot={snapshot!}
							{...item}
							onChange={handleLinksChange}
						/>}
						divided
						onOrderChange={handleOrderChange}
					/>
				)
			}
		</>

	);
};

export default IndexDetailsList;
