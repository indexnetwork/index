import DndList from "components/base/DndList";
import List from "components/base/List";
import { useMergedState } from "hooks/useMergedState";
import React, { useEffect, useState } from "react";
import InfiniteScroll from "react-infinite-scroller";
import api, { LinkSearchResponse, LinkSearchRequestBody } from "services/api-service";
import { Links } from "types/entity";
// import { arrayMove } from "utils/helper";

import { useLinks } from "hooks/useLinks";
import IndexDetailsItem from "../IndexDetailItem";
import NoLinks from "../../indexes/NoLinks";

export interface LinkListState {
	search: string;
	skip: number;
	take: number;
	hasMore: boolean;
}
export interface LinkListProps {
	search: string;
	index_id: string;
	isOwner?: boolean;
	onFetch?(loading: boolean): void;
}

const MemoIndexDetailsItem = React.memo(IndexDetailsItem);

const IndexDetailsList: React.VFC<LinkListProps> = ({
	search,
	index_id,
	isOwner,
	onFetch,
}) => {
	const [loading, setLoading] = useState(false);
	const { links, setLinks } = useLinks();
	const [state, setState] = useMergedState<LinkListState>({
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
			skip: links.length,
			take: state.take,
		} as LinkSearchRequestBody;

		if (searchT !== undefined) {
			queryParams.skip = 0;
			if (searchT.length > 0) {
				queryParams.search = searchT;
			}
		} else if (page) {
			if (state.search && state.search.length > 0) {
				queryParams.search = state.search;
			}
		}

		const res = await api.searchLink(queryParams) as LinkSearchResponse;
		if (res) {
			setState({
				hasMore: res.totalCount > queryParams.skip + queryParams.take,
				take: queryParams.take,
				skip: queryParams.skip,
				search: queryParams.search,
			} as LinkListState);

			setLinks((searchT !== undefined) ? res.records : links.concat(res.records));
		}
		setLoading(false);
	};

	useEffect(() => {
		getData(0, search);
	}, [search, index_id]);

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

	const handleLinksChange = (newLink: Links) => {
		// setItems(newLinks);
	};
	return (
		<>
			{
				links.length === 0 ? (
					<NoLinks search={search}></NoLinks>
				) : (
					search ? (
						<InfiniteScroll
							initialLoad={false}
							hasMore={state.hasMore}
							loadMore={getData}
							marginHeight={50}
						>
							<List
								listClass="index-list"

								render={(item, index, provided, snapshot) => <MemoIndexDetailsItem
									provided={provided!}
									snapshot={snapshot!}
									search={!!search}
									isOwner={isOwner}
									{...item}
									// onChange={handleLinksChange}
								/>}
								divided
								data={links}
							/>
						</InfiniteScroll>
					) : (
						<InfiniteScroll
							initialLoad={false}
							hasMore={state.hasMore}
							loadMore={getData}
							marginHeight={50}
						>
							<DndList <Links>
								listClass="index-detail-list"
								draggable={isOwner}
								data={links}
								render={(item, index, provided, snapshot) => <MemoIndexDetailsItem
									provided={provided!}
									isOwner={isOwner}
									snapshot={snapshot!}
									{...item}
									// onChange={handleLinksChange}
								/>}
								divided
								onOrderChange={handleOrderChange}
							/>
						</InfiniteScroll>
					)
				)
			}
		</>

	);
};

export default IndexDetailsList;
