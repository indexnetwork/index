import React, { ReactElement, useState } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import { useRouter } from "next/router";
import { useAppSelector } from "hooks/store";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Text from "components/base/Text";
import { selectProfile } from "store/slices/profileSlice";
import Button from "components/base/Button";
import Avatar from "components/base/Avatar";
import { appConfig } from "config";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconEditBlack from "components/base/Icon/IconEditBlack";

const CreateIndexPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const [tabKey, setTabKey] = useState("myindexes");
	const [loading, setLoading] = useState(false);
	const router = useRouter();
	const {
		available,
		name,
		bio,
		avatar,
	} = useAppSelector(selectProfile);

	return (
		<>
			<Container
				className="profile-page my-6 my-lg-8"
			>
				<FlexRow
					rowSpacing={1}
					justify="center"
				>
					<Col
						xs={12}
						lg={9}
					>
						<Col pullRight>
							<Button onClick={() => {
								router.push("/profile");
							}} theme="clear"><IconEditBlack /><Text className="ml-2"> Edit Profile</Text></Button>
						</Col>
						<Col>
							<Flex>
								<Avatar className="site-navbar__avatar mr-8" hoverable size={80}>{
									avatar ?
										<img src={`${appConfig.ipfsProxy}/${avatar}`} alt="profile_img"/> : (
											available && name ? name : "Y"
										)}
								</Avatar>
								{available && <Col className="mb-6">
									<Header className="mb-1" >{name}</Header>
									<Col className="mt-5"></Col>
									<Text>{bio}</Text>
								</Col>}
							</Flex>
						</Col>
						<Tabs activeKey={tabKey} onTabChange={setTabKey}>
							<TabPane enabled={true} tabKey={"myindexes"} title={"My indexes"} />
							<TabPane enabled={true} tabKey={"starred"} title={"Starred"} />
							<TabPane tabKey={"discovered"} title={"Discovered"} />
						</Tabs>
					</Col>
				</FlexRow>
			</Container>
		</>
	);
};

CreateIndexPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

CreateIndexPage.requireAuth = true;

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "profile", "components"])),
		},
	};
}
export default CreateIndexPage;
