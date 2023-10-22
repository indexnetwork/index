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
import { useCeramic } from "hooks/useCeramic";
import { useApp } from "hooks/useApp";
import crypto from "crypto";
import apiService from "services/api-service";
import { Indexes } from "types/entity";
import Head from "next/head";
import { maskDID } from "../../utils/helper";

const IndexesPage: NextPageWithLayout = () => {
	const router = useRouter();

	const { did } = router.query;
	const [chatId, setChatId] = useState<string>(uuidv4());
	const personalCeramic = useCeramic();
	const {
		setViewedProfile,
		viewedProfile,
		updateUserIndexState,
	} = useApp();

	const getProfile = async (viewedDid: string) => {
		try {
			const profile = await personalCeramic.getProfileByDID(viewedDid);
			if (profile) {
				setViewedProfile(profile);
			}
			const suggested = localStorage.getItem("suggestIndex");
			if (!suggested) {
				setTimeout(async () => {
					const suggestedIndex = await apiService.getIndexById("kjzl6kcym7w8y7zvi7lvn12vioylmcbv0awup1xj9in1qb4kxp94569hjhx93s5");
					if (suggestedIndex) {
						localStorage.setItem("suggestIndex", "true");
						suggestedIndex.isStarred = true;
						personalCeramic.addUserIndex(suggestedIndex.id, "starred");
						updateUserIndexState({ ...suggestedIndex } as Indexes, "starred", "add");
					}
				}, 500);
			}
		} catch (err) {
			// profile error
		}
	};
	useEffect(() => {
		did && getProfile(did.toString());
	}, [did]);
	useEffect(() => {
		const suffix = crypto.createHash("sha256").update(router.asPath).digest("hex");
		setChatId(`${localStorage.getItem("chatterID")}-${suffix}`);
	}, [router.asPath]);

	return <>
		<PageContainer key={chatId.toString()} page={"profile"}>
			<div className={"scrollable-container"}>
				<AskIndexes id={chatId} did={did!.toString()} />
			</div>
		</PageContainer>
		{ viewedProfile && <Head>
			<title>{viewedProfile.name || maskDID(viewedProfile.id!)} - Index Network</title>
			<meta name="title" content={`${viewedProfile.name || maskDID(viewedProfile.id!)} - Index Network`} />
			<meta name="description" content="The human bridge between context and content." />
		</Head>}
	</>;
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
