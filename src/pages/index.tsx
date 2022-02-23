import React, { ReactElement } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "layout/base/Grid/Container";
import FlexRow from "layout/base/Grid/FlexRow";
import Col from "layout/base/Grid/Col";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import { useTranslation } from "next-i18next";
import Input from "components/base/Input";
import IconSearch from "components/base/Icon/IconSearch";
import IndexList from "components/site/indexes/IndexList";
import PageLayout from "layout/site/PageLayout";

const Home: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	return (
		<Container
			className="idx-my-3 idx-my-lg-8"
		>
			<FlexRow
				rowSpacing={3}
				justify="center"
				className="idx-mb-lg-6"
			>
				<Col
					xs={12}
					lg={9}
				>
					<Input
						addOnBefore={<IconSearch />}
						placeholder={t("pages:home.searchPh")} />
				</Col>
			</FlexRow>
			<FlexRow
				rowSpacing={3}
				justify="center"
			>
				<Col xs={12} lg={9}>
					<Tabs>
						<TabPane
							tabKey="1"
							title={t("pages:home.tab1Ttl", "", {
								count: 14,
							})}
							enabled
						>
							<IndexList shared={false}/>
						</TabPane>
						<TabPane
							tabKey="2"
							title={t("pages:home.tab2Ttl", "", {
								count: 12,
							})}
							enabled
						>
							<IndexList shared={true}/>
						</TabPane>
					</Tabs>
				</Col>
			</FlexRow>
		</Container>
	);
};
Home.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
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
export default Home;
