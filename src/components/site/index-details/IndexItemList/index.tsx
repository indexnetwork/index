import List from "components/base/List";
import { useMergedState } from "hooks/useMergedState";
import React, { useEffect, useState } from "react";
import InfiniteScroll from "react-infinite-scroller";
import api, { LinkSearchResponse, LinkSearchRequestBody } from "services/api-service";
import { Link } from "types/entity";
import { useLinks } from "hooks/useLinks";
import { useIndex } from "hooks/useIndex";
import LinkItem from "../LinkItem";
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
	onFetch?(loading: boolean): void;
}

const MemoLinkItem = React.memo(LinkItem);

const IndexItemList: React.VFC<LinkListProps> = ({
	search,
	index_id,
	onFetch,
}) => {
	const { isOwner } = useIndex();
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

	const handleLinksChange = (newLink: Link) => {
		// setItems(newLinks);
	};
	return (
		<>
			{
				links.length === 0 ? (
					<NoLinks search={search}></NoLinks>
				) : (
					<InfiniteScroll className={"idxflex-grow-1"} useWindow={false} initialLoad={false} hasMore={state.hasMore} loadMore={getData} marginHeight={50}>
						<List
							listClass="index-item-list"
							render={(item) => <MemoLinkItem
								search={!!search}
								index_link={item}
								// onChange={handleLinksChange}
							/>}
							divided
							data={links}
						/>
					</InfiniteScroll>
				)
			}
		</>

	);
};

export default IndexItemList;
