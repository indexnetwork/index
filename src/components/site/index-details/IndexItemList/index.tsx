import List from "components/base/List";
import React, {forwardRef, PropsWithChildren, useEffect, useImperativeHandle, useState} from "react";
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

export interface IndexItemListHandles {
	init():void;
}

const IndexItemList = forwardRef<IndexItemListHandles, LinkListProps>(({
	search,
	indexId,
}, ref) => {
	useImperativeHandle(ref, () => ({
		init: getData,
	}));
	const [loading, setLoading] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const take = 10;
	const { links, setLinks } = useLinks();
	const getData = async () => {
		if (loading) {
			return;
		}
		setLoading(true);

		const queryParams = {
			index_id: indexId,
			skip: links.length,
			take,
		} as LinkSearchRequestBody;
		if (search && search.length > 0) {
			queryParams.search = search;
		}

		const res = await api.searchLink(queryParams) as LinkSearchResponse;
		if (res) {
			setHasMore(res.totalCount > links.length + take);
			setLinks(links.concat(res.records));
		}
		setLoading(false);
	};

	return (
		<>
			{
				links.length === 0 ? (
					<NoLinks search={search}></NoLinks>
				) : (
					<InfiniteScroll className={"idxflex-grow-1"} useWindow={false} initialLoad={false} hasMore={hasMore} loadMore={getData} marginHeight={50}>
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
});

IndexItemList.displayName = "IndexItemList";

export default IndexItemList;
