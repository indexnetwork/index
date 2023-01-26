import DndList from "components/base/DndList";
import List from "components/base/List";
import { useMergedState } from "hooks/useMergedState";
import React, { useEffect, useState } from "react";
import InfiniteScroll from "react-infinite-scroller";
import api, { LinkSearchResponse, LinkSearchRequestBody } from "services/api-service";
import { Links } from "types/entity";
// import { arrayMove } from "utils/helper";
import IndexDetailsItem from "../IndexDetailItem";

export interface LinkListState {
	links: Links[];
	search: string;
	skip: number;
	take: number;
	hasMore: boolean;
}
export interface LinkListProps {
	search: string;
	index_id: string;
	isOwner?: boolean;
	onChange?(links: Links[]): void;
	onFetch?(loading: boolean): void;
}

const MemoIndexDetailsItem = React.memo(IndexDetailsItem);

const IndexDetailsList: React.VFC<LinkListProps> = ({
	search,
	index_id,
	isOwner,
	onChange,
	onFetch,
}) => {
	const [loading, setLoading] = useState(false);
	const [state, setState] = useMergedState<LinkListState>({
		links: [],
		skip: 0,
		take: 10,
		search,
		hasMore: true,
	});

	const getData = async (page?: number, searchT?: string) => {
		if (loading) {
			return;
		}
		setLoading(true);
		const queryParams = {
			index_id,
			skip: state.skip,
			take: state.take,
		} as LinkSearchRequestBody;

		if (searchT !== undefined) {
			queryParams.skip = 0;
			if (searchT.length > 0) {
				queryParams.search = searchT;
			}
		} else if (page) {
			if (state.search && state.search.length > 0){
				queryParams.search = state.search;
			}
			queryParams.skip = state.skip + state.take;
		}

		const res = await api.searchLink(queryParams) as LinkSearchResponse;
		if (res) {
			setState({
				hasMore: res.totalCount > queryParams.skip + queryParams.take,
				take: queryParams.take,
				skip: queryParams.skip,
				links: searchT ? state.links : state.links.concat(res.records),
				search: queryParams.search,
			} as LinkListState);
		}
		setLoading(false);
	};

	useEffect(() => {
		getData(0, search);
	}, [search]);

	useEffect(() => {
		onFetch && onFetch(loading);
	}, [onFetch, loading]);

	const handleOrderChange = (value: {
		source: number,
		destination: number,
	}) => {
		/*
		setItems((oldVal) => {
			const newArray = arrayMove(oldVal, value.source, value.destination);
			onChange && onChange(newArray);
			return newArray;
		});
		 */
	};

	const handleLinksChange = (newLinks: Links[]) => {
		// setItems(newLinks);
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
							data={state.links || []}
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
					<InfiniteScroll
						initialLoad={false}
						hasMore={state.hasMore}
						loadMore={getData}
						marginHeight={50}
					>
					<DndList<Links>
						data={state.links}
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
					</InfiniteScroll>
				)
			}
		</>

	);
};

export default IndexDetailsList;
