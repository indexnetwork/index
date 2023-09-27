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
	const [rightTabKey, setRightTabKey] = useState("history");
	const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
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
				<SearchIndexes setInteractionMode={setInteractionMode} did={"did:pkh:eip155:175177:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f"} />
			</Col>
			<Col className={cc([
				"main-panel",
				`page-${section}`,
			])}>
				<div style={{ marginLeft: "300px", position: "fixed", zIndex: "9999" }}>
					<button onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}>Toggle left</button>
					<button onClick={() => setRightSidebarOpen(!rightSidebarOpen)}>Toggle right</button>
				</div>
				{children}
			</Col>
			<Col className={cc([
				"sidebar-right",
				rightSidebarOpen ? "sidebar-open" : "sidebar-closed",
			])}>
				<Flex className={"pl-6 scrollable-container idxflex-grow-1"} flexDirection={"column"}>
					<FlexRow wrap={false} className={"mt-6 idxflex-grow-1"}>
						<Tabs activeKey={"history"} onTabChange={setRightTabKey}>
							<TabPane enabled={true} tabKey={"history"} title={`History`} />
							<TabPane enabled={false} tabKey={"discover"} title={`Discover`} />
						</Tabs>
					</FlexRow>
					{rightTabKey === "history" && <Flex className={"scrollable-area px-11 idxflex-grow-1"} >
						<div style={{ width: "100px", height: "1500px", background: "linear-gradient(0deg, rgba(255,0,0,1) 0%, rgba(255,255,255,1) 100%)" }}> </div>
					</Flex>}
				</Flex>
			</Col>
		</FlexRow>
	</Container>;
};

export default PageContainer;
