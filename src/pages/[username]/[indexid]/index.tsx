import React, { ReactElement } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "layout/base/Grid/Container";
import FlexRow from "layout/base/Grid/FlexRow";
import Col from "layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import Input from "components/base/Input";
import IconSearch from "components/base/Icon/IconSearch";
import PageLayout from "layout/site/PageLayout";
import IndexDetailsList from "components/site/IndexDetailsList";
import ButtonGroup from "components/base/ButtonGroup";
import Button from "components/base/Button";
import IconFilter from "components/base/Icon/IconFilter";
import IconSort from "components/base/Icon/IconSort";
import SortPopup from "components/site/popup/SortPopup";
import FilterPopup from "components/site/popup/FilterPopup";

const IndexDetailPage: NextPageWithLayout = () => {
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
					<FlexRow>
						<Col
							className="idx-flex-grow-1 idx-mr-5"
						>
							<Input
								addOnBefore={<IconSearch />}
								placeholder={t("pages:home.searchPh")} />
						</Col>
						<Col>
							<ButtonGroup
								theme="clear"
							>
								<FilterPopup>
									<Button
										group
										iconButton
									><IconFilter stroke="var(--gray-4)" /></Button>
								</FilterPopup>
								<SortPopup>
									<Button
										group
										iconButton
									><IconSort stroke="var(--gray-4)" /></Button>
								</SortPopup>
							</ButtonGroup>
						</Col>
					</FlexRow>
				</Col>
			</FlexRow>
			<FlexRow
				rowSpacing={3}
				justify="center"
			>
				<Col xs={12} lg={9}>
					<IndexDetailsList />
				</Col>
			</FlexRow>
		</Container>
	);
};

IndexDetailPage.getLayout = function getLayout(page: ReactElement) {
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
export default IndexDetailPage;
