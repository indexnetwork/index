import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, {
	useState, useEffect,
} from "react";

import List from "components/base/List";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";

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
	all_indexes: IndexListState,
	my_indexes: IndexListState,
	starred: IndexListState,
}
export interface SearchIndexesProps {
	did?: string;
}

const SearchIndexes: React.VFC<SearchIndexesProps> = ({
	did,
}) => {
	const router = useRouter();
	const searchParams = useSearchParams();

	const [init, setInit] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [tabKey, setTabKey] = useState<keyof MultipleIndexListState>((searchParams.get("section") || "my_indexes") as keyof MultipleIndexListState);

	const [hasUserIndex, setHasUserIndex] = useState({ my_indexes: false, starred: false });
	const [state, setState] = useState<MultipleIndexListState>({
		all_indexes: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		} as IndexListState,
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

	const take = 10;

	const { indexId } = router.query;

	useEffect(() => {
		// console.log(indexId, "seref");
		!init && router.push({
			pathname: `/${did}`,
			query: { section: tabKey.toString() || "all_indexes" },
		});
	}, [tabKey]);

	useEffect(() => {
		getData(1, true);
	}, [did]);
	useEffect(() => {
		console.log(searchParams.get("section"), tabKey, "seref");
	}, [searchParams]);

	const getData = async (page?: number, newSearch?: boolean) => {
		if (isLoading) {
			return;
		}
		setIsLoading(true);

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

		const res = await api.searchIndex(queryParams) as IndexSearchResponse;
		if (res) {
			if (init || newSearch) {
				setState({
					all_indexes: {
						hasMore: false,
						indexes: [] as Indexes[],
						totalCount: 0,
					},
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
				newState[tabKey] = {
					hasMore: res[tabKey]?.totalCount! > queryParams.skip + take,
					indexes: newSearch ? res[tabKey]?.records! : state[tabKey]?.indexes?.concat(res[tabKey]?.records!),
					totalCount: res[tabKey]?.totalCount,
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
			{(state[tabKey].totalCount > 0) ? <>
				<InfiniteScroll
					initialLoad={false}
					hasMore={state[tabKey].hasMore}
					loadMore={getData}
					useWindow={false}
					marginHeight={50}
					className={"idxflex-grow-1"}
				>
					<List
						data={state[tabKey].indexes || []}
						render={(itm: Indexes) => <IndexItem
							index={itm}
							selected={itm.id === indexId}
						/>}
						divided={false}
					/>
				</InfiniteScroll>
			</> : <NoIndexes tabKey={tabKey} />}
		</FlexRow>
	</>;
};

export default SearchIndexes;
