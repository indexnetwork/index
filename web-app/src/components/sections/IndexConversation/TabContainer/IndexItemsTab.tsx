import SearchInput from "@/components/base/SearchInput";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import IndexItemList from "@/components/site/index-details/IndexItemList";
import LinkInput from "@/components/site/input/LinkInput";
import { useRole } from "@/hooks/useRole";
import { IndexItem } from "@/types/entity";
import { useCallback, useState } from "react";
import { useIndexConversation } from "../IndexConversationContext";

export default function IndexItemsTabSection() {
  const {
    itemsState,
    setItemsState,
    loading,
    setLoading,
    fetchIndexItems,
    // loadMoreItems,
  } = useIndexConversation();
  const { isCreator } = useRole();
  const { api, ready: apiReady } = useApi();
  const [search, setSearch] = useState("");

  const { viewedIndex } = useApp();

  const handleSearch = useCallback(
    (searchQuery: string) => {
      setSearch(searchQuery);
      fetchIndexItems(true, { query: searchQuery });
    },
    [fetchIndexItems],
  );

  const handleAddLink = useCallback(
    async (urls: string[]) => {
      if (!api || !apiReady || !viewedIndex) return;

      setLoading(true);
      try {
        const createdLink = await api!.crawlLink(urls[0]);
        if (!createdLink) {
          throw new Error("Error creating link");
        }
        const createdItem = await api!.createItem(
          viewedIndex.id,
          createdLink.id,
        );
        console.log("create item", createdItem);
        if (!createdItem) {
          throw new Error("Error creating item");
        }
        setItemsState({
          items: [createdItem, ...itemsState.items],
          cursor: itemsState.cursor,
        });
      } catch (error) {
        console.error("Error adding link", error);
      } finally {
        setLoading(false);
      }
    },
    [viewedIndex, setItemsState, setLoading, apiReady],
  );

  const handleRemove = useCallback(
    (item: IndexItem) => {
      if (!apiReady || !viewedIndex) return;
      setLoading(true);
      api!.deleteItem(viewedIndex.id, item.node.id)
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
    [apiReady, viewedIndex, setItemsState, setLoading],
  );

  return (
    <Flex flexdirection="column" className="idxflex-grow-1">
      <FlexRow className={"mt-6"}>
        <Col className="idxflex-grow-1">
          <SearchInput
            loading={loading}
            onSearch={handleSearch}
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
