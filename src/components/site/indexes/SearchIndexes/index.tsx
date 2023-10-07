import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useEffect } from "react";
import List from "components/base/List";
import { useRouter } from "next/router";
import api, { DidSearchRequestBody, IndexSearchResponse } from "services/api-service";
import { Indexes, IndexListState, MultipleIndexListState } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import NoIndexes from "components/site/indexes/NoIndexes";
import { useApp } from "hooks/useApp";

export interface SearchIndexesProps {
	did?: string;
}

const SearchIndexes: React.VFC<SearchIndexesProps> = ({
	did,
}) => {
	const router = useRouter();
	const {
		section,
		setSection,
		indexes,
		setIndexes,
	} = useApp();

	const take = 10;
	const { indexId } = router.query;

	useEffect(() => {
		getData(1, true);
	}, [did]);
	const getData = async (page?: number, newSearch?: boolean) => {
		const queryParams = {
			did,
			take,
		} as DidSearchRequestBody;

		if (newSearch) {
			queryParams.skip = 0;
		} else {
			queryParams.type = section;
			// @ts-ignore
			queryParams.skip = indexes[section]?.indexes.length;
		}

		const res = await api.searchIndex(queryParams) as IndexSearchResponse;
		if (res) {
			if (newSearch) {
				setIndexes({
					all_indexes: {
						hasMore: res.my_indexes?.totalCount! > queryParams.skip + take,
						indexes: res.my_indexes?.records.slice(0, 1) || [],
						totalCount: res.my_indexes?.totalCount || 0,
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
			} else {
				const newState = indexes;
				newState[section] = {
					hasMore: res[section]?.totalCount! > queryParams.skip + take,
					indexes: newSearch ? res[section]?.records! : indexes[section]?.indexes?.concat(res[section]?.records!),
					totalCount: res[section]?.totalCount,
				} as IndexListState;
				setIndexes(newState as MultipleIndexListState);
			}
		}
	};
	return <>
		<FlexRow className={"mr-6 pb-4"}>
			<Col className="idxflex-grow-1">
				<Tabs theme={"rounded"} activeKey={section} onTabChange={setSection}>
					<TabPane enabled={true} tabKey={"all_indexes"} title={`All Indexes`} />
					<TabPane enabled={true} tabKey={"my_indexes"} total={indexes.my_indexes?.totalCount} title={`Owned`} />
					<TabPane enabled={true} tabKey={"starred"} total={indexes.starred?.totalCount} title={`Starred`} />
				</Tabs>
			</Col>
		</FlexRow>
		<FlexRow className={"scrollable-area index-list pr-6"}>
			{(indexes[section].totalCount > 0) ? <>
				<InfiniteScroll
					initialLoad={false}
					hasMore={indexes[section].hasMore}
					loadMore={getData}
					useWindow={false}
					marginHeight={50}
					className={"idxflex-grow-1"}
				>
					<List
						data={indexes[section].indexes || []}
						render={(itm: Indexes) => <IndexItem
							index={itm}
							selected={itm.id === indexId}
						/>}
						divided={false}
					/>
				</InfiniteScroll>
			</> : <NoIndexes tabKey={section} />}
		</FlexRow>
	</>;
};

export default SearchIndexes;
