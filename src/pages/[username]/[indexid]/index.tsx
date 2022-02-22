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
import ButtonGroup from "components/base/ButtonGroup";
import Button from "components/base/Button";
import Text from "components/base/Text";
import IconFilter from "components/base/Icon/IconFilter";
import IconSort from "components/base/Icon/IconSort";
import SortPopup from "components/site/popup/SortPopup";
import FilterPopup from "components/site/popup/FilterPopup";
import HeaderInput from "components/site/input/HeaderInput";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import Avatar from "components/base/Avatar";
import IconShare from "components/base/Icon/IconShare";
import LinkInput from "components/site/input/LinkInput";
import IndexDetailsList from "components/site/IndexDetailsList";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	return (
		<Container
			className="index-details-page idx-my-6 idx-my-lg-8"
		>
			<FlexRow
				rowSpacing={3}
				justify="center"
			>
				<Col
					xs={12}
					lg={9}
					noYGutters
				>
					<Avatar randomColor size={20}>S</Avatar>
					<Text className="idx-ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">Cnsndnz</Text>
				</Col>
				<Col
					xs={12}
					lg={9}
				>
					<FlexRow>
						<Col
							className="idx-flex-grow-1 idx-mr-5"
						>
							<HeaderInput
								placeholder="Enter your index title"
							/>
						</Col>
						<Col>
							<Button addOnBefore size="sm" theme="clear">
								<IconShare stroke="white" strokeWidth={"1.5"} />Share
							</Button>
						</Col>
						<Col className="idx-ml-3">
							<IndexOperationsPopup
								mode="index-detail-page"
							/>
						</Col>
					</FlexRow>
				</Col>
				<Col xs={12} lg={9} noYGutters className="idx-mb-6">
					<Text size="sm" theme="disabled">Public • Last updated 1 hour ago </Text>
				</Col>
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
				<Col xs={12} lg={9} noYGutters className="idx-pb-0 idx-mt-3">
					<LinkInput
						placeholder="Add a link to you index"
					/>
				</Col>
			</FlexRow>
			<FlexRow
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
