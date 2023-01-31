import List from "components/base/List";
import { useRouter } from "next/router";
import React, {
	useCallback, useEffect, useState,
} from "react";
import api, { DidSearchRequestBody, DidSearchResponse } from "services/api-service";
import { Indexes } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { useMergedState } from "hooks/useMergedState";
import { useOwner } from "hooks/useOwner";
import IndexItem from "../IndexItem";

export interface IndexListProps {
	search?: string;
	onFetch?(loading: boolean): void;
}

export interface IndexListState {
	skip: number;
	take: number;
	search?: string;
	hasMore: boolean;
}

const IndexList: React.VFC<IndexListProps> = ({ search, onFetch }) => {
	const [state, setState] = useMergedState<IndexListState>({
		skip: 0,
		take: 10,
		search,
		hasMore: true,
	});
	const [loading, setLoading] = useState(false);
	const [init, setInit] = useState(false);
	const [hasIndex, setHasIndex] = useState(true);
	const [indexes, setIndexes] = useState<Indexes[]>([]);

	const router = useRouter();

	const { isOwner, did } = useOwner();

	const getData = async (page?: number, searchT?: string) => {
		if (loading) {
			return;
		}
		setLoading(true);

		const queryParams = {
			did,
			skip: indexes.length,
			take: state.take,
		} as DidSearchRequestBody;

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

		const res = await api.searchIndex(queryParams) as DidSearchResponse;

		if (res) {
			setState({
				hasMore: res.totalCount > queryParams.skip + queryParams.take,
				take: queryParams.take,
				skip: queryParams.skip,
				search: queryParams.search,
			} as IndexListState);

			setIndexes((searchT !== undefined) ? res.records : indexes.concat(res.records));
		}
		setLoading(false);
	};

	const handleClick = useCallback((itm: Indexes) => async () => {
		router.push(`/${router.query.did}/${itm.id}`);
	}, []);

	const handleDelete = () => {
		// getData(undefined, true);
	};

	useEffect(() => {
		getData(undefined, search);
	}, [search]);

	useEffect(() => {
		onFetch && onFetch(loading);
	}, [loading]);
	return (
		<>
			<InfiniteScroll
				initialLoad={false}
				hasMore={state.hasMore}
				loadMore={getData}
				marginHeight={50}
			>
				<List
					data={indexes || []}
					listClass="index-list"
					render={(itm: Indexes) => <IndexItem
						hasSearch={!!search}
						onClick={handleClick(itm)}
						onDelete={handleDelete}
						{...itm}
					/>}
					divided
				/>
			</InfiniteScroll>
		</>
	);
};

export default IndexList;
