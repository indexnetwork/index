import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback } from "react";
import List from "components/base/List";
import { useRouter } from "next/router";
import { Indexes } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import { useApp } from "hooks/useApp";
import Text from "components/base/Text";

export interface SearchIndexesProps {}

const SearchIndexes: React.VFC<SearchIndexesProps> = () => {
	const router = useRouter();
	const {
		viewedProfile,
		section,
		indexes,
		getIndexes,
	} = useApp();

	const { did, indexId } = router.query;

	const handleTabChange = useCallback((tabClickValue: string) => {
		if (viewedProfile && tabClickValue) {
			const url = tabClickValue === "all" ?
				`/${viewedProfile.id}` :
				`/${viewedProfile.id}?section=${tabClickValue}`;
			router.replace(`/[did]`, url, { shallow: true });
		}
	}, [viewedProfile]);

	const sortIndexes = (items: Indexes[]) => items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	return <>
		<FlexRow className={"mr-6 pb-4"}>
			<Col className="idxflex-grow-1">
				<Tabs destroyInactiveTabPane={false} theme={"rounded"} activeKey={section} onTabChange={handleTabChange}>
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
					loadMore={getIndexes}
					useWindow={false}
					marginHeight={50}
					className={"idxflex-grow-1"}
				>
					<List
						data={sortIndexes(indexes[section].indexes!) || []}
						render={(itm: Indexes) => <IndexItem
							index={itm}
							selected={itm.id === indexId}
						/>}
						divided={false}
					/>
				</InfiniteScroll>
			</> :
			<Text fontWeight={500} style={{
				 color: "var(--gray-4)",
				 textAlign: "center",
				 padding: "4rem 0",
				 margin: "auto",
				 }}>
				There are no indexes yet
				</Text>}
		</FlexRow>
	</>;
};

export default SearchIndexes;
