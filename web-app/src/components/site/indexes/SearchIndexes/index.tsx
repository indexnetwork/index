import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback, useMemo } from "react";
import List from "components/base/List";
import { useRouter } from "next/router";
import { Indexes } from "types/entity";
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
	} = useApp();

	const { indexId } = router.query;

	const handleTabChange = useCallback((tabClickValue: string) => {
		if (viewedProfile && tabClickValue) {
			const url = tabClickValue === "all" ?
				`/${viewedProfile.id}` :
				`/${viewedProfile.id}?section=${tabClickValue}`;
			router.replace(`/[did]`, url, { shallow: true });
		}
	}, [viewedProfile]);

  const sectionIndexes = useMemo(() => {
		if (section === 'all') {
			return indexes;
		} else {
			return indexes.filter(
				section === 'owner' ? i => i.isOwner === true : i => i.isStarred === true
			);
		}
	}, [indexes, section]);

	return <>
		<FlexRow className={"mr-6 pb-4"}>
			<Col className="idxflex-grow-1">
				<Tabs destroyInactiveTabPane={false} theme={"rounded"} activeKey={section} onTabChange={handleTabChange}>
					<TabPane enabled={true} tabKey={"all"} title={`All Indexes`} />
					<TabPane enabled={true} tabKey={"owner"} total={indexes.filter(i => i.isOwner === true)?.length} title={`Owned`} />
					<TabPane enabled={true} tabKey={"starred"} total={indexes.filter(i => i.isStarred === true)?.length} title={`Starred`} />
				</Tabs>
			</Col>
		</FlexRow>
		<FlexRow className={"scrollable-area index-list pr-6 idxflex-grow-1"}>
			{ (sectionIndexes.length > 0) ? <div className={"idxflex-grow-1"}>
				<List
					data={sectionIndexes}
					render={(itm: Indexes) => <IndexItem
						index={itm}
						selected={itm.id === indexId}
					/>}
					divided={false}
				/>
			</div> :
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
