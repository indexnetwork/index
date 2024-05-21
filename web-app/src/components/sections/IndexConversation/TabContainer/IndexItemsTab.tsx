import SearchInput from "@/components/base/SearchInput";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import IndexItemList from "@/components/site/index-details/IndexItemList";
import LinkInput from "@/components/site/input/LinkInput";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useRole } from "@/hooks/useRole";
import { IndexItem } from "@/types/entity";
import { filterValidUrls, isStreamID, removeDuplicates } from "@/utils/helper";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useIndexConversation } from "../IndexConversationContext";
import Spin from "@/components/base/Spin";

const CONCURRENCY_LIMIT = 10;

export default function IndexItemsTabSection() {
  const {
    itemsState,
    setItemsState,
    loading,
    setLoading,
    searchLoading,
    fetchIndexItems,
    fetchMoreIndexItems,
  } = useIndexConversation();
  const { isCreator } = useRole();
  const { api, ready: apiReady } = useApi();
  const [search, setSearch] = useState("");
  const [addedItem, setAddedItem] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const { viewedIndex } = useApp();

  useEffect(() => {
    if (addedItem) {
      setItemsState({
        items: [addedItem, ...itemsState.items],
        cursor: itemsState.cursor,
      });
    }

    setProgress({
      ...progress,
      current: progress.current + 1,
    });

    if (progress.current === progress.total) {
      setLoading(false);
      setProgress({ current: 0, total: 0 });
    }
  }, [addedItem, setItemsState]);

  const handleSearch = useCallback(
    (searchQuery: string) => {
      if (!viewedIndex) return;
      setSearch(searchQuery);
      fetchIndexItems(viewedIndex?.id, {
        resetCursor: true,
        params: { query: searchQuery },
      });
    },
    [fetchIndexItems],
  );

  const processUrlsInBatches = async (urls: string[], processUrl: any) => {
    let currentIndex = 0;

    const executeNextBatch = async () => {
      if (currentIndex >= urls.length) return;

      const batch = urls.slice(currentIndex, currentIndex + CONCURRENCY_LIMIT);
      currentIndex += CONCURRENCY_LIMIT;

      await Promise.allSettled(batch.map(processUrl));

      await executeNextBatch();
    };

    await executeNextBatch();
  };

  const handleAddItem = useCallback(
    async (inputItems: string[]) => {
      if (!apiReady || !viewedIndex) return;

      // add only unique and valid URLs
      const filteredUrls = filterValidUrls(inputItems);
      const uniqueUrls = removeDuplicates(filteredUrls);
      const urls = removeDuplicates(
        uniqueUrls,
        itemsState.items
          .filter((i) => i.type === "WebPage")
          // @ts-ignore
          .map((i) => i.node.url),
      );

      // add only unique and valid indexes
      const inputIndexIds = inputItems.filter((id) => isStreamID(id));
      const uniqueIndexIds = removeDuplicates(inputIndexIds);
      const indexIds = removeDuplicates(
        uniqueIndexIds,
        itemsState.items
          .filter((i) => i.type === "Index")
          // @ts-ignore
          .map((i) => i.node.id),
      );

      const items = [...urls, ...indexIds];

      console.log("items", indexIds);

      setLoading(true);
      setProgress({ current: 0, total: items.length });

      await processUrlsInBatches(items, async (item: string) => {
        try {
          let itemId = item;

          if (!isStreamID(item)) {
            const createdLink = await api!.crawlLink(item);
            itemId = createdLink.id;
          }

          const createdItem = await api!.createItem(viewedIndex.id, itemId);

          setAddedItem(createdItem);
        } catch (error) {
          console.error("Error adding item", error);
          toast.error(`Error adding item: ${item}`);
        }
      });

      setLoading(false);
    },
    [api, viewedIndex, apiReady],
  );

  const handleRemove = useCallback(
    (item: IndexItem) => {
      if (!apiReady || !viewedIndex) return;
      setLoading(true);
      api!
        .deleteItem(viewedIndex.id, item.node.id)
        .then(() => {
          setItemsState({
            items: itemsState.items.filter((i) => i.node.id !== item.node.id),
            cursor: itemsState.cursor,
          });
          toast.success("Item deleted successfully");
        })
        .catch((error) => {
          console.error("Error deleting item", error);
          toast.error("Error deleting item");
        })
        .finally(() => setLoading(false));
    },
    [
      api,
      apiReady,
      viewedIndex,
      setItemsState,
      itemsState.cursor,
      itemsState.items,
      setLoading,
    ],
  );

  return (
    <Flex flexdirection="column" className="idxflex-grow-1">
      <FlexRow className={"mt-6"}>
        <Col className="idxflex-grow-1">
          <SearchInput
            onSearch={handleSearch}
            debounceTime={300}
            showClear
            defaultValue={search}
            loading={searchLoading}
            placeholder="Search in this index"
          />
        </Col>
      </FlexRow>

      {isCreator && (
        <FlexRow>
          <Col className="idxflex-grow-1 mt-6 pb-0">
            <LinkInput
              loading={loading}
              onItemAdd={handleAddItem}
              progress={progress}
            />
          </Col>
        </FlexRow>
      )}

      <div key={viewedIndex?.id} className={"mb-4 mt-6"}>
        <IndexItemList
          items={itemsState.items}
          search={search}
          hasMore={!!itemsState.cursor}
          removeItem={handleRemove}
          loadMore={() =>
            viewedIndex &&
            fetchMoreIndexItems(viewedIndex?.id, { resetCursor: false })
          }
        />
      </div>
    </Flex>
  );
}
