import SiteNavbar from "components/layout/site/SiteNavbar";
import Head from "next/head";
import React, { useState } from "react";
import cc from "classcat";
import SiteFooter from "../SiteFooter";
import FlexRow from "../../base/Grid/FlexRow";
import Col from "../../base/Grid/Col";
import Flex from "../../base/Grid/Flex";
import Button from "../../../base/Button";
import IconClose from "../../../base/Icon/IconClose";
import Avatar from "../../../base/Avatar";
import Header from "../../../base/Header";
import { maskDID } from "../../../../utils/helper";
import Text from "../../../base/Text";
import SearchIndexes from "../../../site/indexes/SearchIndexes";
import { Tabs } from "../../../base/Tabs";
import TabPane from "../../../base/Tabs/TabPane";
import Soon from "../../../site/indexes/Soon";
import Container from "../../base/Grid/Container";
import { useApp } from "../../../../hooks/useApp";

export interface PageLayoutProps {
	hasFooter?: boolean;
	headerType?: "user" | "public";
	isLanding?: boolean;
	children: React.ReactNode;
	page?: string;
}
const PageLayout = (
	{
		children,
		headerType = "user",
		hasFooter = false,
		isLanding = false,
		page,
	}: PageLayoutProps,
) => {
	const {
		leftSidebarOpen,
		setLeftSidebarOpen,
		rightSidebarOpen,
		setRightSidebarOpen,
		// viewedProfile,
	} = useApp();

	const [rightTabKey, setRightTabKey] = useState("history");
	const closeSidebars = () => {
		setLeftSidebarOpen(false);
		setRightSidebarOpen(false);
	};
	return <>
		<Head>
			<title>Index Network</title>
			{/* <script async src="/scripts/drag-drop-touch.js"></script> */}
		</Head>
		<SiteNavbar headerType={headerType} isLanding={isLanding} />
		<Container
			fluid
			className={"app-container"}
		>
			{(rightSidebarOpen || leftSidebarOpen) && <div onClick={closeSidebars} className={"sidebar-open-backdrop"}></div>}
			<FlexRow>
				<Col className={cc([
					"sidebar-left",
					leftSidebarOpen ? "sidebar-open" : "sidebar-closed",
				])}>
					<FlexRow>
						<Col xs={12} >
							<Flex flexDirection={"column"} className={"scrollable-container"} >
								<Flex justifyContent={"right"} className={"navbar-sidebar-handlers mr-6 mt-6 "}> <Button onClick={() => setLeftSidebarOpen(false)} iconButton theme="clear"><IconClose width={32} /></Button></Flex>
								<FlexRow wrap={false} className={"my-6 mr-6 p-6"} style={{ background: "var(--gray-7)", borderRadius: "5px" }}>
									{/* <Col>
										<Avatar size={60} placeholder={"black"} user={viewedProfile} />
									</Col>
									<Col className="idxflex-grow-1 ml-6">
										<Flex flexDirection={"column"} >
											<Header level={4} className={"mb-1"}>{viewedProfile?.name || (viewedProfile?.id ? maskDID(viewedProfile?.id!) : "")}</Header>
											<Text className={"my-0"} theme="gray6" size="sm" verticalAlign="middle" fontWeight={500} element="p">{viewedProfile?.bio}</Text>
										</Flex>
									</Col> */}
								</FlexRow>
								<SearchIndexes />
							</Flex>
						</Col>
					</FlexRow>
				</Col>
				<Col className={cc([
					"main-panel",
					`page-${page}`,
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
						{rightTabKey === "history" && <Flex className={"scrollable-area px-5 idxflex-grow-1"} >
							<div className={"ml-3"}><Soon section={"chat_history"}></Soon></div>
						</Flex>}
					</Flex>
				</Col>
			</FlexRow>
		</Container>
		{hasFooter && <SiteFooter />}
	</>;
};

export default PageLayout;
