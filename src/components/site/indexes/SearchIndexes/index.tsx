import { useOwner } from "hooks/useOwner";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useTranslation } from "next-i18next";
import React, {
	useState, useCallback, useEffect,
} from "react";

import List from "components/base/List";
import { useRouter } from "next/router";

import api, { DidSearchRequestBody, IndexSearchResponse } from "services/api-service";
import { Indexes } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import { useCeramic } from "hooks/useCeramic";
import NoIndexes from "components/site/indexes/NoIndexes";
import SearchInput from "../../../base/SearchInput";
import RadioGroup from "../../../base/RadioGroup";

export interface IndexListState {
	skip: number,
	totalCount: number,
	hasMore: boolean,
	indexes?: Indexes[],
}
export interface MultipleIndexListState {
	my_indexes?: IndexListState,
	starred?: IndexListState,
}

export interface SearchIndexesProps {
	did?: string;
	setInteractionMode(value: string): void;
}

const SearchIndexes: React.VFC<SearchIndexesProps> = ({
	did,
	setInteractionMode,
}) => {
	const { t } = useTranslation(["pages"]);
	const owner = useOwner();
	const [search, setSearch] = useState("");
	const [askResponse, setAskResponse] = useState("");

	const [init, setInit] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const [tabKey, setTabKey] = useState("my_indexes");
	const [hasUserIndex, setHasUserIndex] = useState({ my_indexes: false, starred: false });
	const [state, setState] = useState<MultipleIndexListState>({
		my_indexes: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		} as IndexListState,
		starred: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		} as IndexListState,
	});
	type StateKey = keyof typeof state;
	const tabKeyStateKey = tabKey as StateKey;

	const take = 10;
	const personalCeramic = useCeramic();
	const router = useRouter();
	useEffect(() => {
		setSearch && setSearch("");
	}, [router]);
	const handleClick = useCallback((itm: Indexes) => async () => {
		router.push(`/${itm.id}`);
	}, []);
	const handleUserIndexToggle = async (index_id: string, type: string, op: string) => {
		const newState = { ...state };

		const typeStateKey = type as StateKey;
		const index: Indexes = (state[tabKeyStateKey] as any).indexes?.filter((i:Indexes) => i.id === index_id)[0];

		newState[tabKeyStateKey]!.indexes = newState[tabKeyStateKey]!.indexes!.map((i:Indexes) => {
			if (i.id === index_id) {
				if (type === "my_indexes") {
					i.is_in_my_indexes = (op === "add");
				}
				if (type === "starred") {
					i.is_starred = (op === "add");
				}
			}
			return i;
		});

		if (op === "add") {
			personalCeramic.addUserIndex(index_id, type);

			newState[typeStateKey]!.indexes = [index, ...newState[typeStateKey]!.indexes!];
			newState[typeStateKey]!.skip = newState[typeStateKey]!.skip + 1;
			newState[typeStateKey]!.totalCount = newState[typeStateKey]!.totalCount + 1;
		} else {
			personalCeramic.removeUserIndex(index_id, type);

			newState[typeStateKey]!.indexes = newState[typeStateKey]!.indexes?.filter((i: Indexes) => i.id !== index_id);
			newState[typeStateKey]!.skip = newState[typeStateKey]!.skip - 1;
			newState[typeStateKey]!.totalCount = newState[typeStateKey]!.totalCount - 1;
		}

		setHasUserIndex({
			my_indexes: newState?.my_indexes?.totalCount! > 0,
			starred: newState?.starred?.totalCount! > 0,
		});
		setState(newState);
	};

	useEffect(() => {
		getData(1, true);
	}, [search]);

	const getData = async (page?: number, newSearch?: boolean) => {
		if (isLoading) {
			return;
		}
		setIsLoading && setIsLoading(true);

		const queryParams = {
			did,
			take,
		} as DidSearchRequestBody;

		if (init || newSearch) {
			queryParams.skip = 0;
		} else {
			queryParams.type = tabKey;
			// @ts-ignore
			queryParams.skip = state[tabKey]?.indexes.length;
		}

		if (search && search.length > 0) {
			queryParams.search = search;
		}

		const res = await api.searchIndex(queryParams) as IndexSearchResponse;
		if (res) {
			if (init || newSearch) {
				setState({
					my_indexes: {
						hasMore: res.my_indexes?.totalCount! > queryParams.skip + take,
						indexes: res.my_indexes?.records || [],
						totalCount: res.my_indexes?.totalCount || 0,
					},
					starred: {
						hasMore: res.starred?.totalCount! > queryParams.skip + take,
						indexes: res.starred?.records || [],
						totalCount: res.starred?.totalCount || 0,
					},
				} as MultipleIndexListState);
				if (init) {
					setHasUserIndex({
						my_indexes: res?.my_indexes?.totalCount! > 0 || false,
						starred: res?.starred?.totalCount! > 0 || false,
					});
				}
				setInit(false);
			} else {
				const newState = state;
				newState[tabKeyStateKey] = {
					hasMore: res[tabKeyStateKey]?.totalCount! > queryParams.skip + take,
					indexes: newSearch ? res[tabKeyStateKey]?.records! : state[tabKeyStateKey]?.indexes?.concat(res[tabKeyStateKey]?.records!),
					totalCount: res[tabKeyStateKey]?.totalCount,
				} as IndexListState;
				setState(newState as MultipleIndexListState);
			}
		}
		setIsLoading && setIsLoading(false);
	};
	return <>
		<FlexRow>
			<Col xs={12} lg={9} centerBlock>
				<FlexRow colGap={2}>
					<Col
						className="idxflex-grow-1 mb-4"
					>
						<SearchInput
							loading={isLoading}
							onSearch={setSearch}
							debounceTime={400}
							showClear
							defaultValue={search}
							placeholder={t("pages:home.searchHome")} />
					</Col>
					<Col>
						<Col>
							<RadioGroup className={"px-1"} value="search" onSelectionChange={(value: "search" | "ask") => setInteractionMode(value)}
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
					</Col>
				</FlexRow>
				<FlexRow>
					<Col className="idxflex-grow-1 mb-4">
						<Tabs activeKey={tabKey} onTabChange={setTabKey}>
							<TabPane enabled={true} tabKey={"my_indexes"} title={`My Indexes (${state.my_indexes?.totalCount || 0})`} />
							<TabPane enabled={true} tabKey={"starred"} title={`Starred (${state.starred?.totalCount || 0})`} />
						</Tabs>
					</Col>
				</FlexRow>
				<FlexRow>
					{tabKey === "my_indexes" ? (
						state.my_indexes && state.my_indexes.indexes?.length! > 0 ? <>
							<InfiniteScroll
								initialLoad={false}
								hasMore={state.my_indexes?.hasMore}
								loadMore={getData}
								marginHeight={50}
							>
								<List
									data={state.my_indexes?.indexes || []}
									listClass="index-list"
									render={(itm: Indexes) => <IndexItem
										hasSearch={!!search}
										onClick={handleClick(itm)}
										isOwner={did === itm.ownerDID?.id}
										userIndexToggle={handleUserIndexToggle}
										index={itm}
									/>}
									divided
								/>
							</InfiniteScroll>
						</> : <NoIndexes hasIndex={hasUserIndex.my_indexes} search={search} tabKey={tabKey} />
					) : (
						state.starred && state.starred.indexes?.length! > 0 ? <>
							<InfiniteScroll
								initialLoad={false}
								hasMore={state.starred?.hasMore}
								loadMore={getData}
								marginHeight={50}
							>
								<List
									data={state.starred?.indexes || []}
									listClass="index-list"
									render={(itm: Indexes) => <IndexItem
										hasSearch={!!search}
										onClick={handleClick(itm)}
										isOwner={did === itm.ownerDID?.id}
										userIndexToggle={handleUserIndexToggle}
										index={itm}
									/>}
									divided
								/>
							</InfiniteScroll>
						</> : <NoIndexes hasIndex={hasUserIndex.starred} search={search} tabKey={tabKey} />
					)}
				</FlexRow>
			</Col>
		</FlexRow>
	</>;
};

export default SearchIndexes;
