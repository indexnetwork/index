import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useEffect, useState } from "react";
import List from "components/base/List";
import { useRouter } from "next/router";
import api, { DidSearchRequestBody, IndexSearchResponse } from "services/api-service";
import { Indexes, MultipleIndexListState } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import NoIndexes from "components/site/indexes/NoIndexes";
import { useApp } from "hooks/useApp";

export interface SearchIndexesProps {
	didParam?: string;
}

const SearchIndexes: React.VFC<SearchIndexesProps> = ({
	didParam,
}) => {
	const router = useRouter();
	const {
		section,
		indexes,
		setIndexes,
	} = useApp();
	const take = 10;
	const { did, indexId } = router.query;

	const [tabClickValue, handleTabClick] = useState<string>();
	useEffect(() => {
		tabClickValue && router.replace(`/[did]`, tabClickValue === "all" ? `/${didParam}` : `/${didParam}?section=${tabClickValue}`, { shallow: true });
	}, [tabClickValue]);

	useEffect(() => {
		getData(1, true);
	}, [didParam]);

	const getData = async (page?: number, newSearch?: boolean) => {
		const queryParams = {
			did: didParam,
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
					all: {
						hasMore: res.all?.totalCount! > queryParams.skip + take,
						indexes: res.all?.records || [],
						totalCount: res.all?.totalCount || 0,
					},
					owner: {
						hasMore: res.owner?.totalCount! > queryParams.skip + take,
						indexes: res.owner?.records || [],
						totalCount: res.owner?.totalCount || 0,
					},
					starred: {
						hasMore: res.starred?.totalCount! > queryParams.skip + take,
						indexes: res.starred?.records || [],
						totalCount: res.starred?.totalCount || 0,
					},
				} as MultipleIndexListState);
			} else {
				setIndexes({
					...indexes,
					[section]: {
						hasMore: res[section]?.totalCount! > queryParams.skip + take,
						// eslint-disable-next-line no-unsafe-optional-chaining
						indexes: newSearch ? res[section]?.records! : [...(indexes[section]?.indexes || []), ...res[section]?.records!],
						totalCount: res[section]?.totalCount,
					},
				} as MultipleIndexListState);
			}
		}
	};
	return <>
		<FlexRow className={"mr-6 pb-4"}>
			<Col className="idxflex-grow-1">
				<Tabs theme={"rounded"} activeKey={section} onTabChange={handleTabClick}>
					<TabPane enabled={true} tabKey={"all"} title={`All Indexes`} />
					<TabPane enabled={true} tabKey={"owner"} total={indexes.owner?.totalCount} title={`Owned`} />
					<TabPane enabled={true} tabKey={"starred"} total={indexes.starred?.totalCount} title={`Starred`} />
				</Tabs>
			</Col>
		</FlexRow>
		<FlexRow className={"scrollable-area index-list pr-6"}>
			{ (indexes[section].totalCount > 0) ? <>
				<InfiniteScroll
					key={section}
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
