import React, {
	ReactElement, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
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
import { v4 as uuidv4 } from "uuid";
import { selectConnection } from "store/slices/connectionSlice";
import { selectProfile } from "store/slices/profileSlice";
import { LinksContext } from "hooks/useLinks";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconStar from "components/base/Icon/IconStar";
import Tooltip from "components/base/Tooltip";
import CeramicService from "services/ceramic-service";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import LitService from "services/lit-service";
import { IndexContext } from "hooks/useIndex";
import AskIndexes from "../../components/site/indexes/AskIndexes";
import PageContainer from "../../components/layout/site/PageContainer";
import Soon from "../../components/site/indexes/Soon";
import Flex from "../../components/layout/base/Grid/Flex";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const { indexId } = router.query;
	const [index, setIndex] = useMergedState<Partial<Indexes>>({});
	const [links, setLinks] = useState<IndexLink[]>([]);
	const [pkpCeramic, setPKPCeramic] = useState<any>();
	const personalCeramic = useCeramic();
	const [addedLink, setAddedLink] = useState<IndexLink>();
	const [tabKey, setTabKey] = useState("chat");
	const [interactionMode, setInteractionMode] = useState("index");
	const [isOwner, setIsOwner] = useState<boolean>(false);
	const [isCreator, setIsCreator] = useState<boolean>(false);
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
	const chatId = uuidv4();
	const loadIndex = async (indexIdParam: string) => {
		const doc = await api.getIndexById(indexIdParam);
		if (!doc) {
			setNotFound(true);
		} else {
			setIndex(doc);
			setLoading(false);
		}
	};
	const loadUserIndex = async () => {
		const sessionResponse = await LitService.getPKPSession(index.pkpPublicKey!, index.collabAction!);
		if (!sessionResponse || !sessionResponse.session) {
			return false;
		}
		setLoading(true);
		setPKPCeramic(new CeramicService(sessionResponse.session.did));
		setIsOwner(sessionResponse.isPermittedAddress);
		setIsCreator(sessionResponse.isCreator || sessionResponse.isPermittedAddress);
		const userIndexes = await api.getUserIndexes({
			index_id: index.id, // TODO Shame
			did,
		} as GetUserIndexesRequestBody) as UserIndexResponse;
		if (userIndexes) {
			setIndex({
				...index,
				is_in_my_indexes: !!userIndexes.my_indexes, // TODO Shame
				is_starred: !!userIndexes.starred,
			} as Indexes);
		}
		setLoading(false);
	};
	const handleCollabActionChange = async (CID: string) => {
		const litContracts = new LitContracts();
		await litContracts.connect();

		const pubKeyHash = ethers.utils.keccak256(index.pkpPublicKey!);
		const tokenId = ethers.BigNumber.from(pubKeyHash);

		const newCollabAction = litContracts.utils.getBytesFromMultihash(CID);
		const previousCollabAction = litContracts.utils.getBytesFromMultihash(index.collabAction!);
		const addPermissionTx = await litContracts.pkpPermissionsContract.write.addPermittedAction(tokenId, newCollabAction, []);
		const removePermissionTx = await litContracts.pkpPermissionsContract.write.removePermittedAction(tokenId, previousCollabAction, []);
		const result = await pkpCeramic.updateIndex(index, {
			collabAction: CID,
		});
		setIndex(result);
	};
	const handleTitleChange = async (title: string) => {
		setTitleLoading(true);
		const result = await pkpCeramic.updateIndex(index, {
			title,
		});
		setIndex(result);
		setTitleLoading(false);
	};

	const handleUserIndexToggle = (index_id: string, type: string, op: string) => {
		if (type === "my_indexes") {
			setIndex({ ...index, is_in_my_indexes: op === "add" } as Indexes);
		} else {
			setIndex({ ...index, is_starred: op === "add" } as Indexes);
		}
		if (op === "add") {
			personalCeramic.addUserIndex(index_id, type);
		} else {
			personalCeramic.removeUserIndex(index_id, type);
		}
	};

	const handleAddLink = async (urls: string[]) => {
		setCrawling(true);

		setProgress({
			current: 0,
			total: urls.length,
		});
		setSearch("");
		// TODO Allow for syntax
		// eslint-disable-next-line no-restricted-syntax
		for await (const url of urls) {
			const payload = await api.crawlLink(url);
			if (payload) {
				const createdLink = await personalCeramic.createLink(payload);
				// TODO Fix that.
				const createdIndexLink = await pkpCeramic.addIndexLink(index, createdLink?.id!);
				if (createdIndexLink) {
					setAddedLink(createdIndexLink); // TODO Fix
				}
			}
		}
	};
	useEffect(() => {
		loadUserIndex();
	}, [index.id, did]);
	useEffect(() => {
		setLoading(true);
		if (indexId) {
			loadIndex(indexId as string);
		}
	}, [indexId]);

	useEffect(() => {
		if (addedLink) {
			setProgress({
				...progress,
				current: progress.current + 1,
			});
			setProgress({ ...progress, current: progress.current + 1 });
			setLinks([addedLink, ...links]);
			index.updatedAt = addedLink.updatedAt;
			setIndex(index);
		}
	}, [addedLink]);

	useEffect(() => {
		if ((progress.current === progress.total) && progress.total > 0) {
			setProgress({
				current: 0,
				total: 0,
			});
		}
		if (progress.total === 0) {
			setCrawling(false);
		}
	}, [progress]);

	return (
		<PageContainer section={"index"}>
			<IndexContext.Provider value={{ pkpCeramic, isOwner, isCreator }}>
				<LinksContext.Provider value={{ links, setLinks }}>
					<Flex className={"px-0 px-md-10 pt-6 scrollable-container"} flexDirection={"column"}>
						{ notFound && <FlexRow>
							<Col className="idxflex-grow-1">
								<NotFound active={true} />
							</Col>
						</FlexRow>
						}
						{ !notFound && <>
							<Flex flexDirection={"column"}>
								<FlexRow>
									<Col centerBlock className="idxflex-grow-1">
										<Avatar size={20}>{isOwner ? (available && name ? name : "") : "O"}</Avatar>
										<Text className="ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">{available && name ? name : ""}</Text>
									</Col>
								</FlexRow>
								<FlexRow className="pt-3">
									<Col className="idxflex-grow-1 mr-5">
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
								<FlexRow>
									<Text size="sm" theme="disabled">{index?.updatedAt ? `Updated ${moment(index.updatedAt).fromNow()}` : ""} </Text>
								</FlexRow>
								<FlexRow>
									<Col className="idxflex-grow-1 mt-3">
										<Tabs activeKey={tabKey} onTabChange={setTabKey}>
											<TabPane enabled={true} tabKey={"chat"} title={"Chat"} />
											<TabPane enabled={true} tabKey={"index"} title={"Index"} />
											<TabPane enabled={true} tabKey={"creators"} title={"Creators"} />
											<TabPane enabled={true} tabKey={"audience"} title={"Audience"} />
										</Tabs>
									</Col>
								</FlexRow>
							</Flex>
							{ tabKey === "index" && <>
								<FlexRow className={"mt-6"}>
									<Col className="idxflex-grow-1">
										<SearchInput
											loading={loading}
											onSearch={setSearch}
											debounceTime={400}
											showClear
											defaultValue={search}
											placeholder={t("pages:home.searchLink")} />
									</Col>
									{ false && <Col>
										<ButtonGroup theme="clear" className="">
											<FilterPopup>
												<Button size={"xl"} group iconButton>
													<IconFilter width={20} height={20} stroke="var(--gray-4)" />
												</Button>
											</FilterPopup>
											<SortPopup>
												<Button size={"xl"} group iconButton>
													<IconSort width={20} height={20} stroke="var(--gray-4)" />
												</Button>
											</SortPopup>
										</ButtonGroup>
									</Col>}
								</FlexRow>
								{isCreator && <FlexRow>
									<Col className="idxflex-grow-1 pb-0 mt-6 mb-3">
										<LinkInput
											loading={crawling}
											onLinkAdd={handleAddLink}
											progress={progress}
										/>
									</Col>
								</FlexRow>}
								<FlexRow className={"scrollable-area"}>
									<IndexItemList
										search={search}
										index_id={router.query.indexId as any}
									/>
								</FlexRow>
							</>}
							{ tabKey === "creators" && <FlexRow className={"mt-6 scrollable-area"}>
								<Col className="idxflex-grow-1">
									<CreatorSettings onChange={handleCollabActionChange} collabAction={index.collabAction!}></CreatorSettings>
								</Col>
							</FlexRow>}
							{ tabKey === "audience" && <FlexRow className={"mt-6"} justify="center">
								<Col>
									<Soon section={tabKey}></Soon>
								</Col>
							</FlexRow>}
							{ tabKey === "chat" && <AskIndexes id={chatId} indexes={[index.id!]} />}
						</>}
					</Flex>
				</LinksContext.Provider>
			</IndexContext.Provider>
		</PageContainer>
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
