import React, { ReactElement, useState } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import HeaderInput from "components/site/input/HeaderInput";
import LinkInput from "components/site/input/LinkInput";
import { Indexes } from "types/entity";
import { useMergedState } from "hooks/useMergedState";
import { useCeramic } from "hooks/useCeramic";
import { useRouter } from "next/router";
import api from "services/api-service";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";

const CreateIndexPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	const router = useRouter();

	const ceramic = useCeramic();

	const { address } = useAppSelector(selectConnection);

	const [crawling, setCrawling] = useState(false);

	const [stream, setStream] = useMergedState<Partial<Indexes>>({
		title: "",
	});

	const [loading, setLoading] = useState(false);

	const handleBlur = async () => {
		setLoading(true);
		if (stream.title || (stream.links && stream.links.length > 0)) {
			const doc = await ceramic.createDoc(stream);
			if (doc != null) {
				router.push(`${address}/${doc.streamId.toString()}`);
			}
		}
		setLoading(false);
	};

	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		const { value } = target;
		setStream({
			title: value,
		});
 	};

	 const handleAddLink = async (linkUrl: string) => {
		setCrawling(true);
		const link = await api.crawlLink(linkUrl);
		if (link) {
			const doc = await ceramic.createDoc({
				title: "Untitled Index",
				links: [link],
			});
			if (doc) {
				await api.crawlLinkContent({
					streamId: doc!.streamId,
					links: doc?.links || [],
				});
				router.push(`${address}/${doc.streamId.toString()}`);
			}
		} else {
			alert("Couldn't get the meta data from url");
		}
		setCrawling(false);
	};

	return (
		<>
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
					>
						<FlexRow>
							<Col
								className="idx-flex-grow-1 idx-mr-5"
							>
								<HeaderInput
									type="text"
									placeholder="Enter your index title"
									onBlur={handleBlur}
									value={stream?.title || ""}
									onChange={handleChange}
									loading={loading}
								/>
							</Col>
						</FlexRow>
					</Col>
					<Col xs={12} lg={9} noYGutters className="idx-pb-0 idx-mt-3">
						<LinkInput
							loading={crawling}
							onLinkAdd={handleAddLink}
						/>
					</Col>
				</FlexRow>
			</Container>
		</>
	);
};

CreateIndexPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

CreateIndexPage.requireAuth = true;

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "components"])),
		},
	};
}
export default CreateIndexPage;
