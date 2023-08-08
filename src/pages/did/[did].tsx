import PageContainer from "components/layout/site/PageContainer";
import PageLayout from "components/layout/site/PageLayout";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement, useState, useEffect,
} from "react";
import { NextPageWithLayout } from "types";
import { useRouter } from "next/router";
import SearchIndexes from "../../components/site/indexes/SearchIndexes";
import AskIndexes from "../../components/site/indexes/AskIndexes";
import RadioGroup from "../../components/base/RadioGroup";
import Col from "../../components/layout/base/Grid/Col";

const IndexesPage: NextPageWithLayout = () => {
	const [interactionMode, setInteractionMode] = useState<string>("search");
	const router = useRouter();
	const { did } = router.query;

	useEffect(() => {
		setInteractionMode("search");
	}, [router.query]);

	return <PageContainer>
		{
			interactionMode === "ask" && <AskIndexes interactionToggle={<Col>
				<RadioGroup className={"px-1"} value="ask" onSelectionChange={(value: "search" | "ask") => setInteractionMode(value)}
					items={[
						{
							value: "search",
							title: "Search",
						},
						{
							value: "ask",
							title: "Ask",
						},
					]}
				/>
			</Col>} did={did!.toString()} />
		}
		{
			interactionMode === "search" && <SearchIndexes setInteractionMode={setInteractionMode} did={did!.toString()} />
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
