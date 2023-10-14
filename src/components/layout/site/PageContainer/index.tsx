import Container, { ContainerProps } from "components/layout/base/Grid/Container";
import React, { useState } from "react";
import cc from "classcat";
import { useApp } from "hooks/useApp";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import Soon from "components/site/indexes/Soon";
import SearchIndexes from "components/site/indexes/SearchIndexes";
import Avatar from "components/base/Avatar";
import Header from "components/base/Header";
import Text from "components/base/Text";
import { maskDID } from "utils/helper";

export interface PageContainerProps extends ContainerProps {
	page: string;
}

const PageContainer = (
	{
		children,
		page,
		...containerProps
	}: PageContainerProps,
) => {
	const {
		leftSidebarOpen,
		setLeftSidebarOpen,
		rightSidebarOpen,
		setRightSidebarOpen,
		viewedProfile,
	} = useApp();

	const [rightTabKey, setRightTabKey] = useState("history");
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
				<FlexRow>
					<Col xs={12} >
						<Flex flexDirection={"column"} className={"scrollable-container"} >
							<Flex justifyContent={"right"} className={"navbar-sidebar-handlers mr-6 mt-6 "}> <Button onClick={() => setLeftSidebarOpen(false)} iconButton theme="clear"><IconClose width={32} /></Button></Flex>
							<FlexRow wrap={false} className={"my-6 mr-6 p-6"} style={{ background: "#efefef", borderRadius: "5px" }}>
								<Col>
									<Avatar size={60} placeholder={"black"} user={viewedProfile} />
								</Col>
								<Col className="idxflex-grow-1 ml-6">
									<Flex flexDirection={"column"} >
										<Header level={4} className={"mb-1"}>{viewedProfile?.name || (viewedProfile?.id ? maskDID(viewedProfile?.id!) : "")}</Header>
										<Text className={"my-0"} size="sm" verticalAlign="middle" fontWeight={500} element="p">{viewedProfile?.bio}</Text>
									</Flex>
								</Col>
							</FlexRow>
							{ viewedProfile && viewedProfile.id && <SearchIndexes didParam={viewedProfile.id} />}
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
					{rightTabKey === "history" && <Flex className={"scrollable-area px-11 idxflex-grow-1"} >
						<div className={"ml-3"}><Soon section={"chat_history"}></Soon></div>
					</Flex>}
				</Flex>
			</Col>
		</FlexRow>
	</Container>;
};

export default PageContainer;
