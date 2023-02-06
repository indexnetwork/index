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
import { useAppDispatch, useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { selectProfile } from "store/slices/profileSlice";

import { LinksContext } from "hooks/useLinks";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconStar from "components/base/Icon/IconStar";
import Tooltip from "components/base/Tooltip";
import Header from "components/base/Header";
import Soon from "components/site/indexes/Soon";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	// const [shareModalVisible, setShareModalVisible] = useState(false);
	const dispatch = useAppDispatch();
	const [index, setIndex] = useMergedState<Partial<Indexes>>({});
	const [links, setLinks] = useState<Links[]>([]);
	const [addedLink, setAddedLink] = useState<Links>();
	const [tab, setTab] = useState<boolean>(false);
	const [tabKey, setTabKey] = useState("index");

	const [notFound, setNotFound] = useState(false);
	const [crawling, setCrawling] = useState(false);
	const [loading, setLoading] = useState(false);
	const [titleLoading, setTitleLoading] = useState(false);
	const [search, setSearch] = useState("");

	const [tokenModalVisible, setTokenModalVisible] = useState(false);

	const { did } = useAppSelector(selectConnection);
	const { available, name } = useAppSelector(selectProfile);

	const { isOwner } = useOwner();
	const ceramic = useCeramic();

	const router = useRouter();

	// const handleToggleShareModal = () => {
	// 	setShareModalVisible((oldVal) => !oldVal);
	// };

	const handleToggleTokenModal = () => {
		setTokenModalVisible((oldVal) => !oldVal);
	 };

	const loadIndex = async (id: string) => {
		const doc = await ceramic.getIndexById(id);
		if (doc != null) {
			setIndex(doc);
		} else {
			setNotFound(true);
		}
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
	const handleAddLink = async (urls: string[]) => {
		setCrawling(true);

		urls.forEach(async (url) => {
			const payload = await api.crawlLink(url);
			if (payload) {
				const link = await ceramic.addLink(index?.id!, payload);
				if (link) {
					setAddedLink(link);
				}
			}
		});

		setCrawling(false);
	};

	const handleReorderLinks = async (ls: Links[]) => {

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
	}, [router.query]);

	useEffect(() => {
		if (addedLink) {
			setLinks([addedLink, ...links]);
			index.updated_at = addedLink.updated_at;
			setIndex(index);
		}
	}, [addedLink]);

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
											className="pb-0"
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
												<Col className="mr-1">
													<Tooltip content="Add to Starred Index">
														<Button
														theme="clear"
														borderless>
														<IconStar className="mr-3" width={20} height={20} />
														</Button>
													</Tooltip>
												</Col>
												<Col className="ml-1">
													<Button
													theme="clear"
													borderless>
													<IndexOperationsPopup
														isOwner={isOwner}
														streamId={index.id!}
														mode="indexes-page"
														onDelete={handleDelete}
													></IndexOperationsPopup>
													</Button>
												</Col>
											</FlexRow>
										</Col>
										<Col xs={12} lg={9} noYGutters className="mb-1">
											<Text size="sm" theme="disabled">{index?.updated_at ? `Updated ${moment(index.updated_at).fromNow()}` : ""} </Text>
										</Col>
										<Col
											xs={12}
											lg={9}
										>
											<FlexRow>
												<Col className="idxflex-grow-1 mb-4">
													<Tabs activeKey={tabKey} onTabChange={setTabKey}>
														<TabPane enabled={true} tabKey={"index"} title={"Index"} />
														<TabPane enabled={true} tabKey={"curators"} title={"Creators"} />
														<TabPane enabled={true} tabKey={"audiences"} title={"Audiences"} />
													</Tabs>
												</Col>
											</FlexRow>
											<FlexRow>
											{tabKey==="index" ?
												<>
												
													<Col
														className="idxflex-grow-1 mr-5 mt-2"
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
															className="mt-2"
														>
															<FilterPopup>
																<Button
																	size={"xl"}
																	group
																	iconButton
																>
																	<IconFilter width={20} height={20} stroke="var(--gray-4)" /></Button>
															</FilterPopup>
															<SortPopup>
																<Button
																	size={"xl"}
																	group
																	iconButton
																><IconSort width={20} height={20} stroke="var(--gray-4)" /></Button>
															</SortPopup>
														</ButtonGroup>
													</Col>
													
												</>
												: <Col></Col>}
											</FlexRow>
										</Col>
										{
											tabKey==="index" && isOwner &&	<Col xs={12} lg={9} noYGutters className="pb-0 mt-3 mb-3">
												<LinkInput
													loading={crawling}
													onLinkAdd={handleAddLink}
												/>
											</Col>
										}
									</FlexRow>
									{tabKey === "index" ? 
									<FlexRow
										justify="center"
									>

										<Col xs={12} lg={9}>
											<IndexDetailsList
												search={search}
												isOwner={isOwner}
												index_id={router.query.id as any}
												// onChange={handleReorderLinks}
											/>
										</Col>

										<Col xs={12} lg={9}>
										</Col>
									</FlexRow>
									: <Col></Col>}

									{tabKey === "index" ? 
									<Col></Col> :
									<FlexRow justify="center">
										<Soon></Soon>
									</FlexRow>
									
									}
								</>
							)
					}
				</Container>

				{/* <TokenModal data={{ }} visible={tokenModalVisible} onClose={handleToggleTokenModal}></TokenModal> */}
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
