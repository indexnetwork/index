import List from "components/base/List";
import React, { useEffect, useState } from "react";
import InfiniteScroll from "react-infinite-scroller";
import api, { LinkSearchResponse, LinkSearchRequestBody } from "services/api-service";
import { useLinks } from "hooks/useLinks";
import LinkItem from "../LinkItem";
import NoLinks from "../../indexes/NoLinks";

export interface LinkListProps {
	indexId: string;
	search: string;
}

const MemoLinkItem = React.memo(LinkItem);

const IndexItemList: React.VFC<LinkListProps> = ({ search, indexId }) => {
	const [loading, setLoading] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const take = 10;
	const { links, setLinks } = useLinks();
	const getData = async (page: number, init?: boolean) => {
		if (loading && !init) {
			return;
		}
		setLoading(true);

		const queryParams = {
			index_id: indexId,
			skip: init ? 0 : links.length,
			take,
		} as LinkSearchRequestBody;
		if (search && search.length > 0) {
			queryParams.search = search;
		}

		const res = await api.searchLink(queryParams) as LinkSearchResponse;
		if (res) {
			setHasMore(res.totalCount > links.length + take);
			setLinks(init ? res.records : [...links, ...res.records]);
		}
		setLoading(false);
	};

	useEffect(() => {
		getData(0, true);
	}, [indexId, search]);
	return (
		<>
			{
				links.length === 0 ? (
					<NoLinks tabKey={"items"} search={search}></NoLinks>
				) : (
					<InfiniteScroll className={"scrollable-area idxflex-grow-1 pb-6"} useWindow={false} hasMore={hasMore} loadMore={getData} marginHeight={50}>
						<List
							listClass="index-item-list "
							render={(item) => <MemoLinkItem
								search={!!search}
								index_link={item}
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
