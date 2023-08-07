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
import AskInput from "../../components/base/AskInput";
import RadioGroup from "../../components/base/RadioGroup";
import SearchIndexes from "../../components/site/indexes/SearchIndexes";
import AskIndexes from "../../components/site/indexes/AskIndexes";

const IndexesPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const [search, setSearch] = useState("");
	const [prompt, setPrompt] = useState("");
	const [loading, setLoading] = useState(false);
	const [interactionMode, setInteractionMode] = useState<"search" | "ask">("search");
	const router = useRouter();
	const { did } = router.query;
	useEffect(() => {
		search && setSearch("");
	}, [router]);
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
				style={{ position: "fixed", bottom: "20px", width: "720px" }}
			>
				<FlexRow colSpacing={1}>
					<Col
						className="idxflex-grow-1"
					>
						{
							interactionMode === "search" && <SearchInput
								loading={loading}
								onSearch={setSearch}
								debounceTime={400}
								showClear
								defaultValue={search}
								placeholder={t("pages:home.searchHome")} />
						}
						{
							interactionMode === "ask" && <AskInput onEnter={handleAsk} placeholder={t("pages:home.askHome")} />
						}
					</Col>
					<Col>
						<RadioGroup className={" px-1"} value={interactionMode} onSelectionChange={(value: "search" | "ask") => setInteractionMode(value)}
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
					</Col>
				</FlexRow>
			</Col>
			{
				interactionMode === "ask" && <Col xs={12} lg={9}>
					<AskIndexes loading={loading} onLoading={setLoading} did={did!.toString()} prompt={prompt} />
				</Col>
			}
			{
				interactionMode === "search" && <Col xs={12} lg={9}>
					<SearchIndexes loading={loading} onLoading={setLoading} did={did!.toString()} search={search} />
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
