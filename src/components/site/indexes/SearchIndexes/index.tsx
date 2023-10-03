import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, {
	useState, useCallback, useEffect,
} from "react";

import List from "components/base/List";
import { useRouter } from "next/router";

import api, { DidSearchRequestBody, IndexSearchResponse } from "services/api-service";
import { Indexes } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import NoIndexes from "components/site/indexes/NoIndexes";

export interface IndexListState {
	skip: number,
	totalCount: number,
	hasMore: boolean,
	indexes?: Indexes[],
}
export interface MultipleIndexListState {
	my_indexes?: IndexListState,
	starred?: IndexListState,
}

export interface SearchIndexesProps {
	did?: string;
}

const SearchIndexes: React.VFC<SearchIndexesProps> = ({
	did,
}) => {
	const [search, setSearch] = useState("");
	const [init, setInit] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [tabKey, setTabKey] = useState("my_indexes");
	const [hasUserIndex, setHasUserIndex] = useState({ my_indexes: false, starred: false });
	const [state, setState] = useState<MultipleIndexListState>({
		my_indexes: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		} as IndexListState,
		starred: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		} as IndexListState,
	});
	type StateKey = keyof typeof state;
	const tabKeyStateKey = tabKey as StateKey;

	const take = 10;
	const router = useRouter();
	const { indexId } = router.query;
	useEffect(() => {
		setSearch && setSearch("");
	}, [router]);

	useEffect(() => {
		getData(1, true);
	}, [search]);

	const getData = async (page?: number, newSearch?: boolean) => {
		if (isLoading) {
			return;
		}
		setIsLoading && setIsLoading(true);

		const queryParams = {
			did,
			take,
		} as DidSearchRequestBody;

		if (init || newSearch) {
			queryParams.skip = 0;
		} else {
			queryParams.type = tabKey;
			// @ts-ignore
			queryParams.skip = state[tabKey]?.indexes.length;
		}

		if (search && search.length > 0) {
			queryParams.search = search;
		}
		const res = await api.searchIndex(queryParams) as IndexSearchResponse;
		if (res) {
			if (init || newSearch) {
				setState({
					my_indexes: {
						hasMore: res.my_indexes?.totalCount! > queryParams.skip + take,
						indexes: res.my_indexes?.records || [],
						totalCount: res.my_indexes?.totalCount || 0,
					},
					starred: {
						hasMore: res.starred?.totalCount! > queryParams.skip + take,
						indexes: res.starred?.records || [],
						totalCount: res.starred?.totalCount || 0,
					},
				} as MultipleIndexListState);
				if (init) {
					setHasUserIndex({
						my_indexes: res?.my_indexes?.totalCount! > 0 || false,
						starred: res?.starred?.totalCount! > 0 || false,
					});
				}
				setInit(false);
			} else {
				const newState = state;
				newState[tabKeyStateKey] = {
					hasMore: res[tabKeyStateKey]?.totalCount! > queryParams.skip + take,
					indexes: newSearch ? res[tabKeyStateKey]?.records! : state[tabKeyStateKey]?.indexes?.concat(res[tabKeyStateKey]?.records!),
					totalCount: res[tabKeyStateKey]?.totalCount,
				} as IndexListState;
				setState(newState as MultipleIndexListState);
			}
		}
		setIsLoading && setIsLoading(false);
	};
	return <>
		<FlexRow className={"mr-6 pb-4"}>
			<Col className="idxflex-grow-1">
				<Tabs theme={"rounded"} activeKey={tabKey} onTabChange={setTabKey}>
					<TabPane enabled={true} tabKey={"all_indexes"} title={`All Indexes`} />
					<TabPane enabled={true} tabKey={"my_indexes"} total={state.my_indexes?.totalCount} title={`Owned`} />
					<TabPane enabled={true} tabKey={"starred"} total={state.starred?.totalCount} title={`Starred`} />
				</Tabs>
			</Col>
		</FlexRow>
		<FlexRow className={"scrollable-area index-list pr-6"}>
			{tabKey === "my_indexes" ? (
				state.my_indexes && state.my_indexes.indexes?.length! > 0 ? <>
					<InfiniteScroll
						initialLoad={false}
						hasMore={state.my_indexes?.hasMore}
						loadMore={getData}
						useWindow={false}
						marginHeight={50}
						className={"idxflex-grow-1"}
					>
						<List
							data={state.my_indexes?.indexes || []}
							render={(itm: Indexes) => <IndexItem
								index={itm}
								selected={itm.id === indexId}
							/>}
							divided={false}
						/>
					</InfiniteScroll>
				</> : <NoIndexes hasIndex={hasUserIndex.my_indexes} search={search} tabKey={tabKey} />
			) : (
				state.starred && state.starred.indexes?.length! > 0 ? <>
					<InfiniteScroll
						initialLoad={false}
						hasMore={state.starred?.hasMore}
						loadMore={getData}
						useWindow={false}
						marginHeight={50}
						className={"idxflex-grow-1"}
					>
						<List
							data={state.starred?.indexes || []}
							render={(itm: Indexes) => <IndexItem
								index={itm}
								selected={itm.id === indexId}
							/>}
							divided
						/>
					</InfiniteScroll>
				</> : <NoIndexes hasIndex={hasUserIndex.starred} search={search} tabKey={tabKey} />
			)}
		</FlexRow>
	</>;
};

export default SearchIndexes;
