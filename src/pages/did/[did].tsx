import SearchInput from "components/base/SearchInput";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import PageContainer from "components/layout/site/PageContainer";
import PageLayout from "components/layout/site/PageLayout";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement, useState, useEffect,
} from "react";
import { NextPageWithLayout } from "types";
import { useRouter } from "next/router";
import SearchIndexes from "../../components/site/indexes/SearchIndexes";
import AskIndexes from "../../components/site/indexes/AskIndexes";

const IndexesPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	const [prompt, setPrompt] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [interactionMode, setInteractionMode] = useState<string>("search");
	const router = useRouter();
	const { did } = router.query;

	const handleAsk = async (value: string) => {
		setPrompt && setPrompt(value);
	};
	return <PageContainer>
		<FlexRow
			rowSpacing={3}
			justify="center"
		>

			<Col
				xs={12}
				lg={9}
				centerBlock
				style={ interactionMode === "ask" ? { position: "fixed", bottom: "20px", width: "720px" } : {} }
			>
			</Col>
			{
				interactionMode === "ask" && <Col xs={12} lg={9}>
					{/* eslint-disable-next-line max-len */}
					<AskIndexes setInteractionMode={setInteractionMode} onLoading={setIsLoading} did={did!.toString()} />
				</Col>
			}
			{
				interactionMode === "search" && <Col xs={12} lg={9}>
					<SearchIndexes setInteractionMode={setInteractionMode} onLoading={setIsLoading} did={did!.toString()} />
				</Col>
			}
		</FlexRow>
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
