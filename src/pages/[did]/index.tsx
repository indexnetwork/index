import PageContainer from "components/layout/site/PageContainer";
import PageLayout from "components/layout/site/PageLayout";
import AskIndexes from "components/site/indexes/AskIndexes";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { useRouter } from "next/router";
import { v4 as uuidv4 } from "uuid";

const IndexesPage: NextPageWithLayout = () => {
	const router = useRouter();

	const { did } = router.query;
	const [chatId, setChatId] = useState<string>(uuidv4());

	useEffect(() => {
		setChatId(uuidv4());
	}, [did, router]);

	return <PageContainer page={"profile"}>
		<div className={"scrollable-container"}>
			<AskIndexes id={chatId} did={did!.toString()}  />
		</div>
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
