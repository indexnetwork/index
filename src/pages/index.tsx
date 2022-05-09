import IconSearch from "components/base/Icon/IconSearch";
import Input from "components/base/Input";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import IndexList from "components/site/indexes/IndexList";
import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import PageContainer from "layout/site/PageContainer";
import PageLayout from "layout/site/PageLayout";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, { ReactElement } from "react";
import { NextPageWithLayout } from "types";

const Home: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	return (
		<PageContainer>
			<FlexRow
				rowSpacing={3}
				justify="center"
				className="idx-mb-lg-6"
			>
				<Col
					xs={12}
					centerBlock
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
		</PageContainer>);
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
