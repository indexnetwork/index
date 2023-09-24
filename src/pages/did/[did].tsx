import PageContainer from "components/layout/site/PageContainer";
import PageLayout from "components/layout/site/PageLayout";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement, useState, useEffect,
} from "react";
import { NextPageWithLayout } from "types";
import { useRouter } from "next/router";
import { v4 as uuidv4 } from "uuid";
import SearchIndexes from "../../components/site/indexes/SearchIndexes";
import AskIndexes from "../../components/site/indexes/AskIndexes";
import RadioGroup from "../../components/base/RadioGroup";
import Col from "../../components/layout/base/Grid/Col";
import Drawer from 'react-modern-drawer'
import 'react-modern-drawer/dist/index.css'
import FlexRow from "../../components/layout/base/Grid/FlexRow";
import {Tabs} from "../../components/base/Tabs";
import TabPane from "../../components/base/Tabs/TabPane";
import LinkInput from "../../components/site/input/LinkInput";
import Flex from "../../components/layout/base/Grid/Flex";

const IndexesPage: NextPageWithLayout = () => {
	const router = useRouter();
	const { did } = router.query;
	const chatId = uuidv4();
	const [interactionMode, setInteractionMode] = useState<string>("search");
	const [rightTabKey, setRightTabKey] = useState("history");

	const [isOpen, setIsOpen] = React.useState(false);
	const toggleDrawer = () => {
		setIsOpen((prevState) => !prevState)
	};
	return <PageContainer fluid className={"my-0 app-container"}>
		{ false && <div className="drawer-left">
			<Drawer
				open={true}
				onClose={toggleDrawer}
				direction="left"
			>
				<SearchIndexes setInteractionMode={setInteractionMode} did={did!.toString()} />
			</Drawer>
		</div>}
		<FlexRow>
			<Col className={"sidebar-left"} style={{ width: "32rem" }} >
				<SearchIndexes setInteractionMode={setInteractionMode} did={did!.toString()} />
			</Col>
			<Col style={{width: "calc(100% - 64rem)", maxWidth: "calc(100% - 64rem)"}}>
				<AskIndexes id={chatId} did={did!.toString()} />
			</Col>
			<Col className={"sidebar-right"} style={{ width: "32rem" }} >
				<Flex className={"pl-6 scrollable-container idxflex-grow-1"} flexDirection={"column"} style={{"word-break": "break-word"}}>
					<FlexRow wrap={false} className={"mt-6 idxflex-grow-1"}>
						<Tabs activeKey={"history"} onTabChange={setRightTabKey}>
							<TabPane enabled={true} tabKey={"history"} title={`History`} />
							<TabPane enabled={false} tabKey={"discover"} title={`Discover`} />
						</Tabs>
					</FlexRow>
					{rightTabKey === "history" && <Flex className={"scrollable-area px-11 idxflex-grow-1"} >
						<div style={{width: "100px", height: "1500px", background: "linear-gradient(0deg, rgba(255,0,0,1) 0%, rgba(255,255,255,1) 100%)"}}> </div>
					</Flex>}
				</Flex>
			</Col>
		</FlexRow>

		{
			false && <>
				<button onClick={toggleDrawer}>Show</button>
				</>
		}
	</PageContainer>;
};

IndexesPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
			headerType="user"
		>
			{page}
		</PageLayout>
	);
};

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "components"])),
		},
	};
}
export default IndexesPage;
