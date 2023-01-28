import React, {
	ReactElement, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import ButtonGroup from "components/base/ButtonGroup";
import Button from "components/base/Button";
import Text from "components/base/Text";
import IconFilter from "components/base/Icon/IconFilter";
import IconSort from "components/base/Icon/IconSort";
import SortPopup from "components/site/popup/SortPopup";
import FilterPopup from "components/site/popup/FilterPopup";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import Avatar from "components/base/Avatar";
import LinkInput from "components/site/input/LinkInput";
import IndexDetailsList from "components/site/index-details/IndexDetailsList";
import { useRouter } from "next/router";
import { Indexes, Links } from "types/entity";
import api from "services/api-service";
import IndexTitleInput from "components/site/input/IndexTitleInput";
import { useCeramic } from "hooks/useCeramic";
import { useMergedState } from "hooks/useMergedState";
import moment from "moment";
import { copyToClipboard } from "utils/helper";
import IconLink1 from "components/base/Icon/IconLink1";
import IconCopy from "components/base/Icon/IconCopy";
import SearchInput from "components/base/SearchInput";
import NotFound from "components/site/indexes/NotFound";
import { useOwner } from "hooks/useOwner";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { selectProfile } from "store/slices/profileSlice";

import { LinksContext } from "hooks/useLinks";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	// const [shareModalVisible, setShareModalVisible] = useState(false);
	const [index, setIndex] = useMergedState<Partial<Indexes>>({});
	const [links, setLinks] = useState<Links[]>([]);

	const [notFound, setNotFound] = useState(false);
	const [crawling, setCrawling] = useState(false);
	const [loading, setLoading] = useState(false);
	const [titleLoading, setTitleLoading] = useState(false);
	const [search, setSearch] = useState("");

	const { did } = useAppSelector(selectConnection);
	const { available, name } = useAppSelector(selectProfile);

	const { isOwner } = useOwner();
	const ceramic = useCeramic();

	const router = useRouter();

	// const handleToggleShareModal = () => {
	// 	setShareModalVisible((oldVal) => !oldVal);
	// };

	const loadIndex = async (id: string) => {
		const doc = await ceramic.getIndexById(id);
		if (doc != null) {
			setIndex(doc);
		} else {
			setNotFound(true);
		}
	};
	const handleChangeLinks = async (ld: Links[]) => {
		setLinks(ld);
	};

	const handleTitleChange = async (title: string) => {
		setTitleLoading(true);
		const result = await ceramic.updateIndex(index.id!, {
			title,
		});
		setIndex(result);
		setTitleLoading(false);
	};

	const handleDelete = () => {
		router.push(`/${did}`);
	};

	const handleAddLink = async (linkUrl: string) => {
		setCrawling(true);
		const payload = await api.crawlLink(linkUrl);
		if (payload) {
			const link = await ceramic.addLink(index?.id!, payload);
			setLinks([link, ...links]);



			// lc.links = [link]; // TODO Concat or spread

			/*
			await api.crawlLinkContent({
				streamId: stream?.streamId!,
				links: newLinks,
			});
			 */
		} else {
			alert("Couldn't get the meta data from url");
		}
		setCrawling(false);
	};

	const handleReorderLinks = async (links: Links[]) => {
		/*
		const result = await ceramic.putLinks(index?.streamId!, links);
		if (result) {
			await api.putIndex({ ...result.content, streamId: result.id.toString() });
		}
		setIndex(result.content);
		 */
	};

	const handleClone = async () => {
		/*
		const originalDoc = await ceramic.getIndexById(index.id!);

		const content = { ...originalDoc.content };
		content.clonedFrom = stream.streamId!;

		delete (content as any).did;
		delete (content as any).streamId;

		const doc = await ceramic.createIndex(content);

		if (doc != null) {
			router.push(`/${did}/${doc.streamId.toString()}`);
		}

		 */
	};

	useEffect(() => {
		const { id } = router.query;
		if (router.query) {
			loadIndex(id as string);
		} else {
			setNotFound(true);
		}
	}, []);

	return (
		<LinksContext.Provider
			value={{ links, setLinks }}
		>
			<>
				<Container
					className="index-details-page my-6 my-lg-8"
				>
					{
						notFound ?
							<FlexRow
								rowSpacing={3}
								justify="center"
							>
								<NotFound active={true} />
							</FlexRow> : (
								<>
									<FlexRow
										rowSpacing={3}
										justify="center"
									>
										<Col
											xs={12}
											lg={9}
											noYGutters
										>
											<Avatar randomColor size={20}>{isOwner ? (available && name ? name : "Y") : "O"}</Avatar>
											<Text className="ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">{isOwner && available && name ? name : index?.controller_did}</Text>
										</Col>
										<Col
											xs={12}
											lg={9}
											className="pb-2"
										>
											<FlexRow>
												<Col
													className="idxflex-grow-1 mr-5"
												>
													<IndexTitleInput
														defaultValue={index?.title || ""}
														onChange={handleTitleChange}
														disabled={!isOwner}
														loading={titleLoading}
													/>
												</Col>
												<Col>

													{

														false ? (
															(did || "").toLowerCase() === router.query.did ? (
																<Button
																	addOnBefore
																	size="sm"
																	theme="clear"
																	onClick={() => {
																		copyToClipboard(window.location.href);
																	}}
																>
																	<IconLink1 stroke="var(--gray-4)" width={12} strokeWidth={"1.5"} />Copy
																</Button>
															) : (
																<Button
																	addOnBefore
																	size="sm"
																	theme="clear"
																	onClick={handleClone}
																>
																	<IconCopy stroke="var(--gray-4)" width={12} strokeWidth={"1.5"} />Clone
																</Button>
															)
														) : null
													}

												</Col>
												<Col className="ml-3">
													<Button
														className="mr-1"
														size="sm"
														theme="clear">Add to my indexes
													</Button>
												</Col>
												<Col className="ml-3">

													<IndexOperationsPopup
														isOwner={isOwner}
														streamId={index.id!}
														mode="index-detail-page"
														onDelete={handleDelete}
													/>
												</Col>
											</FlexRow>
										</Col>
										<Col xs={12} lg={9} noYGutters className="mb-6">
											<Text size="sm" theme="disabled">{index?.updated_at ? `Updated ${moment(index.updated_at).fromNow()}` : ""} </Text>
										</Col>
										<Col
											xs={12}
											lg={9}
										>
											<FlexRow>
												<Col
													className="idxflex-grow-1 mr-5"
												>
													<SearchInput
														loading={loading}
														onSearch={setSearch}
														debounceTime={400}
														showClear
														placeholder={t("pages:home.searchLink")} />
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
										{
											isOwner &&	<Col xs={12} lg={9} noYGutters className="pb-0 mt-3">
												<LinkInput
													loading={crawling}
													onLinkAdd={handleAddLink}
												/>
											</Col>
										}
									</FlexRow>
									<FlexRow
										justify="center"
									>
										<Col xs={12} lg={9}>
											<IndexDetailsList
												search={search}
												isOwner={isOwner}
												index_id={router.query.id as any}
												onChange={handleReorderLinks}
												onChangeLinks={handleChangeLinks}
											/>
										</Col>
									</FlexRow>
								</>
							)
					}
				</Container>
				{/* <ShareModal data={{}} visible={shareModalVisible} onClose={handleToggleShareModal} /> */}
			</>
		</LinksContext.Provider>
	);
};

IndexDetailPage.getLayout = function getLayout(page: ReactElement) {
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
export default IndexDetailPage;
