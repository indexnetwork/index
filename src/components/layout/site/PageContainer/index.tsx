import Container, { ContainerProps } from "components/layout/base/Grid/Container";
import React, { useState } from "react";
import cc from "classcat";
import { useRouter } from "next/router";
import FlexRow from "../../base/Grid/FlexRow";
import Col from "../../base/Grid/Col";
import SearchIndexes from "../../../site/indexes/SearchIndexes";
import Flex from "../../base/Grid/Flex";
import { Tabs } from "../../../base/Tabs";
import TabPane from "../../../base/Tabs/TabPane";
import Soon from "../../../site/indexes/Soon";
import {useApp} from "../../../../hooks/useApp";
import Button from "../../../base/Button";
import IconHistory from "../../../base/Icon/IconHistory";
import IconClose from "../../../base/Icon/IconClose";

export interface PageContainerProps extends ContainerProps {
	section: string;
}

const PageContainer = (
	{
		children,
		section,
		className,
		...containerProps
	}: PageContainerProps,
) => {
	const { leftSidebarOpen, setLeftSidebarOpen, rightSidebarOpen, setRightSidebarOpen } = useApp();
	const [rightTabKey, setRightTabKey] = useState("history");
	const [interactionMode, setInteractionMode] = useState<string>("search");
	const router = useRouter();
	const { did } = router.query;
	const closeSidebars = () => {
		setLeftSidebarOpen(false);
		setRightSidebarOpen(false);
	};
	return <Container
		fluid
		className={"app-container"}
		{...containerProps}
	>
		{(rightSidebarOpen || leftSidebarOpen) && <div onClick={closeSidebars} className={"sidebar-open-backdrop"}></div>}
		<FlexRow>
			<Col className={cc([
				"sidebar-left",
				leftSidebarOpen ? "sidebar-open" : "sidebar-closed",
			])}>
				<Flex justifyContent={"right"} className={"navbar-sidebar-handlers mr-6 mt-6 idxflex-grow-1"}> <Button onClick={() => setLeftSidebarOpen(false)} iconButton theme="clear"><IconClose width={32} /></Button></Flex>
				<SearchIndexes setInteractionMode={setInteractionMode} did={"did:pkh:eip155:175177:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f"} />
			</Col>
			<Col className={cc([
				"main-panel",
				`page-${section}`,
			])}>
				{children}
			</Col>
			<Col className={cc([
				"sidebar-right",
				rightSidebarOpen ? "sidebar-open" : "sidebar-closed",
			])}>
				<Flex justifyContent={"left"} className={"navbar-sidebar-handlers ml-6 mt-6 idxflex-grow-1"}> <Button onClick={() => setRightSidebarOpen(false)} iconButton theme="clear"><IconClose width={32} /></Button></Flex>
				<Flex className={"pl-6 scrollable-container idxflex-grow-1"} flexDirection={"column"}>
					<FlexRow wrap={false} className={"mt-6 idxflex-grow-1"}>
						<Tabs activeKey={"history"} onTabChange={setRightTabKey}>
							<TabPane enabled={true} tabKey={"history"} title={`History`} />
							<TabPane enabled={false} tabKey={"discover"} title={``} />
						</Tabs>
					</FlexRow>
					{rightTabKey === "history" && <Flex className={"scrollable-area px-11 idxflex-grow-1"} >
						<div className={"ml-3"}><Soon section={"chat_history"}></Soon></div>
					</Flex>}
				</Flex>
			</Col>
		</FlexRow>
	</Container>;
};

export default PageContainer;
