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
import IndexItemList from "components/site/index-details/IndexItemList";
import CreatorSettings from "components/site/index-details/CreatorSettings";
import { useRouter } from "next/router";
import { Indexes, IndexLink } from "types/entity";
import api, { GetUserIndexesRequestBody, UserIndexResponse } from "services/api-service";
import IndexTitleInput from "components/site/input/IndexTitleInput";
import { useCeramic } from "hooks/useCeramic";
import { useMergedState } from "hooks/useMergedState";
import moment from "moment";
import SearchInput from "components/base/SearchInput";
import NotFound from "components/site/indexes/NotFound";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { selectProfile } from "store/slices/profileSlice";
import { LinksContext } from "hooks/useLinks";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconStar from "components/base/Icon/IconStar";
import Tooltip from "components/base/Tooltip";
import Soon from "components/site/indexes/Soon";
import { DID } from "dids";
import { decodeDIDWithLit } from "../../utils/lit";
import LitService from "../../services/lit-service";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const { indexId } = router.query;
	const [index, setIndex] = useMergedState<Partial<Indexes>>({});
	const [links, setLinks] = useState<IndexLink[]>([]);
	const [pkpDID, setPKPDID] = useState<DID>();
	const [addedLink, setAddedLink] = useState<IndexLink>();
	const [tabKey, setTabKey] = useState("index");
	const [isOwner, setIsOwner] = useState<boolean>(false);
	const [notFound, setNotFound] = useState(false);
	const [progress, setProgress] = useState({
		current: 0,
		total: 0,
	});
	const [crawling, setCrawling] = useState(false);
	const [loading, setLoading] = useState(false);
	const [titleLoading, setTitleLoading] = useState(false);
	const [search, setSearch] = useState("");
	const { did } = useAppSelector(selectConnection);
	const { available, name } = useAppSelector(selectProfile);

	const ceramic = useCeramic();

	const loadIndex = async (id: string) => {
		const doc = await ceramic.getIndexById(id);
		if (!doc) {
			setNotFound(true);
		} else {
			setIndex(doc);

			const pkpPublicKey = decodeDIDWithLit(doc.controller_did?.id);
			const pkpDIDResult = await LitService.authenticatePKP(doc.collab_action!, pkpPublicKey);
			if (pkpDIDResult) {
				setPKPDID(pkpDIDResult);
				setIsOwner(true);
			}

			await loadUserIndex(id);
			setLoading(false);
		}
	};
	const loadUserIndex = async (index_id: string) => {
		const userIndexes = await api.getUserIndexes({
			index_id, // TODO Shame
			did,
		} as GetUserIndexesRequestBody) as UserIndexResponse;
		setIndex({
 			...index,
			is_in_my_indexes: !!userIndexes.my_indexes, // TODO Shame
			is_starred: !!userIndexes.starred,
		} as Indexes);
	};
	const handleTitleChange = async (title: string) => {
		setTitleLoading(true);
		const result = await ceramic.updateIndex(index, {
			title,
		});
		setIndex(result);
		setTitleLoading(false);
	};

	const handleUserIndexToggle = (index_id: string, type: string, op: string) => {
		type === "my_indexes" ? setIndex({ ...index, is_in_my_indexes: op === "add" } as Indexes) : setIndex({ ...index, is_starred: op === "add" } as Indexes);
		if (op === "add") {
			ceramic.addUserIndex(index_id, type);
		} else {
			ceramic.removeUserIndex(index_id, type);
		}
	};
	const handleAddLink = async (urls: string[]) => {
		setCrawling(true);

		setProgress({
			current: 0,
			total: urls.length,
		});
		// TODO Allow for syntax
		// eslint-disable-next-line no-restricted-syntax
		for await (const url of urls) {
			const payload = await api.crawlLink(url);
			if (payload) {
				const createdLink = await ceramic.createLink(payload);
				// TODO Fix that.
				const createdIndexLink = await ceramic.addIndexLink(index, createdLink?.id!);
				if (createdIndexLink) {
					setAddedLink(createdIndexLink); // TODO Fix
				}
			}
		}
	};
	useEffect(() => {
		setLoading(true);
		if (indexId && did) {
			loadIndex(indexId as string);
		}
	}, [indexId, did]);

	useEffect(() => {
		if (addedLink) {
			setProgress({
				...progress,
				current: progress.current + 1,
			});
			setProgress({ ...progress, current: progress.current + 1 });
			setLinks([addedLink, ...links]);
			index.updated_at = addedLink.updated_at;
			setIndex(index);
		}
	}, [addedLink]);

	useEffect(() => {
		if ((progress.current === progress.total) && progress.total > 0) {
			setProgress({
				current: 0,
				total: 0,
			});
			setCrawling(false);
		}
	}, [progress]);

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
											<Text className="ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">{isOwner && available && name ? name : index?.owner_did?.id}</Text>
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
												<Col className="mr-2 mb-3">
													<Tooltip content="Add to Starred Index">
														<Button
															iconHover
															theme="clear"
															onClick={() => handleUserIndexToggle(index.id!, "starred", index.is_starred ? "remove" : "add") }
															borderless>
															<IconStar fill={index.is_starred ? "var(--main)" : "var(--white)"} width={20} height={20} />
														</Button>
													</Tooltip>
												</Col>
												<Col className="ml-2 mb-3">
													<Button
														iconHover
														theme="clear"
														borderless>
														<IndexOperationsPopup
															isOwner={isOwner}
															streamId={index.id!}
															is_in_my_indexes={index.is_in_my_indexes!} // TODO-user_index
															mode="indexes-page"
															userIndexToggle={handleUserIndexToggle}
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
														<TabPane enabled={true} tabKey={"creators"} title={"Creators"} />
														<TabPane enabled={true} tabKey={"audiences"} title={"Audiences"} />
													</Tabs>
												</Col>
											</FlexRow>
											<FlexRow>
												{tabKey === "index" ?
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

													</> :
													<Col></Col>}
											</FlexRow>
										</Col>
										{
											tabKey === "index" && isOwner &&	<Col xs={12} lg={9} noYGutters className="pb-0 mt-3 mb-3">
												<LinkInput
													loading={crawling}
													onLinkAdd={handleAddLink}
													progress={progress}
												/>
											</Col>
										}
									</FlexRow>
									{tabKey === "index" ?
										<FlexRow
											justify="center"
										>
											<Col xs={12} lg={9}>
												<IndexItemList
													search={search}
													isOwner={isOwner}
													index_id={router.query.indexId as any}
												// onChange={handleReorderLinks}
												/>
											</Col>
										</FlexRow> : tabKey === "creators" ?
											<Col>
												<FlexRow justify="center">
													<Col xs={12} lg={9}>
														<CreatorSettings collabAction={index.collab_action!}></CreatorSettings>
													</Col>
												</FlexRow>
											</Col> : <Col>
												<FlexRow justify="center">
													<Soon section={tabKey}></Soon>
												</FlexRow>
											</Col>
									}
								</>
							)
					}
				</Container>
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
