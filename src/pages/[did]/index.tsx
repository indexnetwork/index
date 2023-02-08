import SearchInput from "components/base/SearchInput";
import { useOwner } from "hooks/useOwner";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import PageContainer from "components/layout/site/PageContainer";
import PageLayout from "components/layout/site/PageLayout";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement, useState, useCallback, useEffect,
} from "react";
import { NextPageWithLayout } from "types";

import List from "components/base/List";
import { useRouter } from "next/router";

import api, { DidSearchRequestBody, IndexSearchResponse } from "services/api-service";
import { Indexes } from "types/entity";
import InfiniteScroll from "react-infinite-scroller";
import { useMergedState } from "hooks/useMergedState";
import { Tabs } from "../../components/base/Tabs";
import TabPane from "../../components/base/Tabs/TabPane";

import IndexItem from "../../components/site/indexes/IndexItem";

export interface IndexListState {
	my_indexes?: {
		skip: number,
		totalCount: number,
		hasMore: boolean,
		indexes?: Indexes[],
	},
	starred?: {
		skip: number,
		totalCount: number,
		hasMore: boolean,
		indexes?: Indexes[],
	},
}

const IndexesPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(false);
	const { isOwner, did } = useOwner();
	const [init, setInit] = useState(true);

	const take = 10;
	const router = useRouter();
	const handleClick = useCallback((itm: Indexes) => async () => {
		router.push(`/${router.query.did}/${itm.id}`);
	}, []);

	const handleDelete = () => {
		// getData(undefined, true);
	};

	useEffect(() => {
		getData(1, true);
	}, [search]);

	const [tabKey, setTabKey] = useState("my_indexes");
	const [state, setState] = useMergedState<IndexListState>({
		my_indexes: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		},
		starred: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [],
		},
	});
	type StateKey = keyof typeof state;

	const getData = async (page?: number, newSearch?: boolean) => {
		if (loading) {
			return;
		}
		setLoading(true);

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
						indexes: newSearch ? res.my_indexes?.records! : state.my_indexes?.indexes?.concat(res.my_indexes?.records!),
						totalCount: res.my_indexes?.totalCount,
					},
					starred: {
						hasMore: res.starred?.totalCount! > queryParams.skip + take,
						indexes: newSearch ? res.starred?.records! : state.starred?.indexes?.concat(res.my_indexes?.records!),
						totalCount: res.starred?.totalCount,
					},
				} as IndexListState);
				setInit(false);
			} else {
				const newState = state;
				const tabKeyStateKey = tabKey as StateKey;
				newState[tabKeyStateKey] = {
					hasMore: res[tabKeyStateKey]?.totalCount! > queryParams.skip + take,
					indexes: newSearch ? res[tabKeyStateKey]?.records! : state[tabKeyStateKey]?.indexes?.concat(res[tabKeyStateKey]?.records!),
					totalCount: res[tabKeyStateKey]?.totalCount,
				} as any;
				setState(newState as IndexListState);
			}
		}
		setLoading(false);
	};

	return (
		<PageContainer>
			<FlexRow
				rowSpacing={3}
				justify="center"
			>
				<Col
					xs={12}
					lg={9}
					centerBlock
				>
					<SearchInput
						loading={loading}
						onSearch={setSearch}
						debounceTime={400}
						showClear
					/>
				</Col>
				<Col xs={12} lg={9}>
					<FlexRow>
						<Col className="idxflex-grow-1 mb-4">
							<Tabs activeKey={tabKey} onTabChange={setTabKey}>
								<TabPane enabled={true} tabKey={"my_indexes"} title={`My Indexes (${state.my_indexes?.totalCount})`} />
								<TabPane enabled={true} tabKey={"starred"} title={`Starred (${state.starred?.totalCount})`} />
							</Tabs>
						</Col>
					</FlexRow>
					{tabKey === "my_indexes" ?
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
									onDelete={handleDelete}
									{...itm}
								/>}
								divided
							/>
						</InfiniteScroll> : <InfiniteScroll
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
									onDelete={handleDelete}
									{...itm}
								/>}
								divided
							/>
						</InfiniteScroll>
					}
				</Col>
			</FlexRow>
		</PageContainer>);
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
