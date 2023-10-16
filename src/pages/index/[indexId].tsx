import React, {
	ReactElement, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import Button from "components/base/Button";
import Text from "components/base/Text";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import Avatar from "components/base/Avatar";
import LinkInput from "components/site/input/LinkInput";
import IndexItemList from "components/site/index-details/IndexItemList";
import CreatorSettings from "components/site/index-details/CreatorSettings";
import { useRouter } from "next/router";
import { Indexes, IndexLink, MultipleIndexListState } from "types/entity";
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
import { LinksContext } from "hooks/useLinks";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconStar from "components/base/Icon/IconStar";
import Tooltip from "components/base/Tooltip";
import AskIndexes from "components/site/indexes/AskIndexes";
import PageContainer from "components/layout/site/PageContainer";
import Soon from "components/site/indexes/Soon";
import Flex from "components/layout/base/Grid/Flex";
import CeramicService from "services/ceramic-service";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import LitService from "services/lit-service";
import { IndexContext } from "hooks/useIndex";
import Link from "next/link";
import { maskDID } from "utils/helper";
import { useApp } from "hooks/useApp";
import { selectProfile } from "store/slices/profileSlice";
import { DID } from "dids";
import crypto from "crypto";

const IndexDetailPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const { indexId } = router.query;
	const [index, setIndex] = useMergedState<Partial<Indexes>>({});
	const [links, setLinks] = useState<IndexLink[]>([]);
	const personalCeramic = useCeramic();
	const [pkpCeramic, setPKPCeramic] = useState<any>();
	const [addedLink, setAddedLink] = useState<IndexLink>();
	const [tabKey, setTabKey] = useState("chat");
	const [notFound, setNotFound] = useState(false);
	const [progress, setProgress] = useState({
		current: 0,
		total: 0,
	});
	const profile = useAppSelector(selectProfile);
	const [crawling, setCrawling] = useState(false);
	const [loading, setLoading] = useState(false);
	const [chatId, setChatId] = useState(uuidv4());
	const [titleLoading, setTitleLoading] = useState(false);
	const [search, setSearch] = useState("");
	const { did } = useAppSelector(selectConnection);
	const {
		viewedProfile,
		setViewedProfile,
		updateUserIndexState,
		updateIndex,
	} = useApp();

	const loadIndex = async (indexIdParam: string) => {
		const doc = await api.getIndexById(indexIdParam);
		if (!doc) {
			setNotFound(true);
			return;
		}
		!viewedProfile && setViewedProfile(doc.ownerDID);
		const c = new CeramicService(getPKPSessionDID(doc));
		setIndex(doc);
		setPKPCeramic(c);
		setLoading(false);
	};
	const loadUserIndex = async () => {
		const userIndexes = await api.getUserIndexes({
			index_id: index.id, // TODO Shame
			did,
		} as GetUserIndexesRequestBody) as UserIndexResponse;

		if (userIndexes) {
			const newIndex = {
				...index,
				isOwner: userIndexes.owner && !userIndexes.owner.deletedAt,
				isStarred: userIndexes.starred && !userIndexes.starred.deletedAt,
			} as Indexes;
			setIndex(newIndex);
		}
	};
	const getPKPSessionDID: (index: Indexes) => () => Promise<DID> = (i: Indexes) => async () => {
		try {
			const sessionResponse = await LitService.getPKPSession(i.pkpPublicKey!, i.collabAction!);
			if (sessionResponse && sessionResponse.session) {
				return sessionResponse.session.did;
			}
		} catch (error) {
			throw new Error("Could not get PKP session DID");
		}
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

	const handleUserIndexToggle = (toggleIndex: Indexes, type: string, op: string) => {
		let updatedIndex: Indexes;
		if (type === "owner") {
			updatedIndex = { ...toggleIndex, isOwner: op === "add" };
		} else {
			updatedIndex = { ...toggleIndex, isStarred: op === "add" };
		}
		setIndex(updatedIndex);
		(viewedProfile && viewedProfile.id === profile.id) && updateUserIndexState(updatedIndex, type as keyof MultipleIndexListState, op);
		if (op === "add") {
			personalCeramic.addUserIndex(updatedIndex.id, type);
		} else {
			personalCeramic.removeUserIndex(updatedIndex.id, type);
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
				const createdIndexLink = await pkpCeramic.addIndexLink(index as Indexes, createdLink?.id!);
				if (createdIndexLink) {
					setAddedLink(createdIndexLink); // TODO Fix
				}
			}
		}
	};

	useEffect(() => {
		index.id && did && loadUserIndex();
	}, [index.id, did]);

	useEffect(() => {
		if (viewedProfile && viewedProfile.id === profile.id) {
			updateIndex(index as Indexes);
		}
	}, [index.isOwner, index.isStarred, index.title, index.ownerDID]);
	useEffect(() => {
		if (!indexId) return;
		const suffix = crypto.createHash("sha256").update(indexId as string).digest("hex");
		setChatId(`${localStorage.getItem("chatterID")}-${suffix}`);
		setLoading(true);
		setPKPCeramic(null);
		setSearch("");
		if (indexId) {
			loadIndex(indexId as string);
		}
	}, [indexId]);

	useEffect(() => {
		if (!index || !profile) return;
		const newIndex = { ...index, ownerDID: profile };
		newIndex.isOwner = index.ownerDID && profile ? index.ownerDID!.id === profile.id : false;
		if (index.ownerDID && index.ownerDID.id === profile.id) {
			setIndex(newIndex);
		}
	}, [profile]);

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
		<PageContainer key={indexId!.toString()} page={"index"}>
			<IndexContext.Provider value={{
				pkpCeramic, isOwner: index.isOwner!, isCreator: index.isCreator!, index,
			}}>
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
										<Link href="/[did]" as={`/${index.ownerDID?.id!}`} >
											<Avatar size={20} user={index.ownerDID} />
											<Text className="ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">
												{index.ownerDID?.name || (index.ownerDID && maskDID(index.ownerDID?.id!)) || ""}
											</Text>
										</Link>
									</Col>
								</FlexRow>
								<FlexRow className="pt-3">
									<Col className="idxflex-grow-1 mr-5">
										<IndexTitleInput
											defaultValue={index?.title || ""}
											onChange={handleTitleChange}
											disabled={!index.isOwner}
											loading={titleLoading}
										/>
									</Col>
									<Col className="mr-2 mb-3">
										<Tooltip content="Add to Starred Index">
											<Button
												iconHover
												theme="clear"
												onClick={() => handleUserIndexToggle(index as Indexes, "starred", index.isStarred ? "remove" : "add") }
												borderless>
												<IconStar fill={index.isStarred ? "var(--main)" : "var(--white)"} width={20} height={20} />
											</Button>
										</Tooltip>
									</Col>
									<Col className="ml-2 mb-3">
										<Button
											iconHover
											theme="clear"
											borderless>
											<IndexOperationsPopup
												isOwner={profile && index && index.ownerDID && index.ownerDID.id === profile.id}
												index={index as Indexes}
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
											debounceTime={300}
											showClear
											defaultValue={search}
											placeholder={t("pages:home.searchLink")} />
									</Col>
								</FlexRow>
								{index.isOwner && <FlexRow>
									<Col className="idxflex-grow-1 pb-0 mt-6">
										<LinkInput
											loading={crawling}
											onLinkAdd={handleAddLink}
											progress={progress}
										/>
									</Col>
								</FlexRow>}
								<FlexRow key={indexId!.toString()} className={"scrollable-area mb-4 mt-6"} justify="center">
									<IndexItemList
										search={search}
										indexId={router.query.indexId as any}
									/>
								</FlexRow>
							</>}
							{ tabKey === "creators" && <FlexRow className={"mt-6 scrollable-area"}>
								<Col className="idxflex-grow-1">
									<CreatorSettings onChange={handleCollabActionChange} collabAction={index.collabAction!}></CreatorSettings>
								</Col>
							</FlexRow>}
							{ tabKey === "audience" && <FlexRow justify="center" align="center" fullHeight>
								<Col>
									<Soon section={tabKey}></Soon>
								</Col>
							</FlexRow>}
							{ tabKey === "chat" && chatId && <AskIndexes id={indexId!.toString()} indexes={[index.id!]} />}
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
