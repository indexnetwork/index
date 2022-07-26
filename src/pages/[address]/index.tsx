import SearchInput from "components/base/SearchInput";
import IndexList from "components/site/indexes/IndexList";
import { useOwner } from "hooks/useOwner";
import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import PageContainer from "layout/site/PageContainer";
import PageLayout from "layout/site/PageLayout";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, { ReactElement, useState } from "react";
import { NextPageWithLayout } from "types";

const IndexesPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	const [search, setSearch] = useState("");

	const [loading, setLoading] = useState(false);

	const { isOwner } = useOwner();

	return (
		<PageContainer>
			<FlexRow
				rowSpacing={3}
				justify="center"
			>
				{
					isOwner && (
						<Col
							xs={12}
							lg={9}
							centerBlock
						>
							<SearchInput
								loading={loading}
								onSearch={setSearch}
								debounceTime={400}
								showClear
							/>
						</Col>
					)
				}
				<Col xs={12} lg={9}>
					<IndexList search={search} shared={false} onFetch={setLoading}/>
				</Col>
			</FlexRow>
		</PageContainer>);
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
