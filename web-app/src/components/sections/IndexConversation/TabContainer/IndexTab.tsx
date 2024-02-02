import React, { useCallback, useEffect } from "react";
import SearchInput from "@/components/base/SearchInput";
import Col from "@/components/layout/base/Grid/Col";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useApi } from "@/components/site/context/APIContext";
import LinkInput from "@/components/site/input/LinkInput";
import IndexItemList from "@/components/site/index-details/IndexItemList";
import { useRole } from "@/hooks/useRole";
import { useIndexConversation } from "../IndexConversationContext";
import Flex from "@/components/layout/base/Grid/Flex";
import { useApp } from "@/components/site/context/AppContext";
import { IndexItem } from "@/types/entity";

export default function IndexTabSection() {
  const { itemsState, setItemsState, loading, setLoading } =
    useIndexConversation();
  const { isCreator } = useRole();
  const { apiService: api } = useApi();
  const [search, setSearch] = React.useState("");

  const { viewedIndex } = useApp();

  const handleAddLink = useCallback(
    async (urls: string[]) => {
      if (!api || !viewedIndex) return;
      setLoading(true);
      for (const url of urls) {
        try {
          const createdLink = await api.crawlLink(url);
          if (createdLink) {
            const resp = await api.createItem(viewedIndex.id, createdLink.id);
            if (resp && resp.id) {
              const createdItem = await api.getItem(viewedIndex.id, resp.id);
              setItemsState({
                items: [createdItem, ...itemsState.items],
                cursor: itemsState.cursor,
              });
            }
          }
        } catch (error) {
          console.error("Error adding link", error);
        }
      }
      setLoading(false);
    },
    [api, viewedIndex, setItemsState, setLoading],
  );

  const handleRemove = useCallback(
    (item: IndexItem) => {
      if (!api || !viewedIndex) return;
      setLoading(true);
      api
        .deleteItem(viewedIndex.id, item.node.id)
        .then(() => {
          setItemsState({
            items: itemsState.items.filter((i) => i.node.id !== item.node.id),
            cursor: itemsState.cursor,
          });
        })
        .catch((error) => {
          console.error("Error deleting item", error);
        })
        .finally(() => setLoading(false));
    },
    [api, viewedIndex, setItemsState, setLoading],
  );

  // useEffect(() => {
  //   // Assuming there's a fetch function to initially load items or based on search
  //   // loadItems(); // Load initial items or based on search criteria
  // }, [search, viewedIndex, loadMoreItems]);

  return (
    <Flex flexdirection="column" className="idxflex-grow-1">
      <FlexRow className={"mt-6"}>
        <Col className="idxflex-grow-1">
          <SearchInput
            loading={loading}
            onSearch={setSearch}
            debounceTime={300}
            showClear
            defaultValue={search}
            placeholder="Search in this index"
          />
        </Col>
      </FlexRow>

      {isCreator && (
        <FlexRow>
          <Col className="idxflex-grow-1 mt-6 pb-0">
            <LinkInput
              loading={loading}
              onLinkAdd={handleAddLink}
              // progress={progress}
            />
          </Col>
        </FlexRow>
      )}

      <FlexRow
        key={viewedIndex?.id}
        className={"scrollable-container mb-4 mt-6"}
        justify="center"
      >
        <IndexItemList
          items={itemsState.items}
          search={search}
          hasMore={!!itemsState.cursor}
          removeItem={handleRemove}
          // loadMore={fetchIndexItems}
          loadMore={() => {}}
        />
      </FlexRow>
    </Flex>
  );
}
