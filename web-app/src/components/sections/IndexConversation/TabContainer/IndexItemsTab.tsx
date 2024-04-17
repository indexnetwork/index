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
import { filterValidUrls, removeDuplicates } from "@/utils/helper";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useIndexConversation } from "../IndexConversationContext";

const CONCURRENCY_LIMIT = 10;

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
      setSearch(searchQuery);
      fetchIndexItems(true, { query: searchQuery });
    },
    [fetchIndexItems],
  );

  const processUrlsInBatches = async (urls: string[], processUrl: any) => {
    let currentIndex = 0;

    const executeNextBatch = async () => {
      if (currentIndex >= urls.length) return;

      // Determine the next batch of URLs to process
      const batch = urls.slice(currentIndex, currentIndex + CONCURRENCY_LIMIT);
      currentIndex += CONCURRENCY_LIMIT;

      // Process the current batch
      await Promise.allSettled(batch.map(processUrl));

      // Execute the next batch
      await executeNextBatch();
    };

    await executeNextBatch();
  };

  const handleAddItem = useCallback(
    async (inputUrls: string[]) => {
      if (!apiReady || !viewedIndex) return;

      // add only unique and valid URLs
      const filteredUrls = filterValidUrls(inputUrls);
      const uniqueUrls = removeDuplicates(filteredUrls);
      const urls = removeDuplicates(
        uniqueUrls,
        itemsState.items.map((i) => i.node.url),
      );

      setLoading(true);
      setProgress({ current: 0, total: urls.length });

      await processUrlsInBatches(urls, async (url: string) => {
        try {
          const createdLink = await api!.crawlLink(url);
          if (!createdLink) return;

          const createdItem = await api!.createItem(
            viewedIndex.id,
            createdLink.id,
          );

          setAddedItem(createdItem);
        } catch (error) {
          console.error("Error adding item", error);
          toast.error(`Error adding item: ${url}`);
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
            // loading={loading}
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
          loadMore={() => fetchIndexItems(false)}
        />
      </div>
    </Flex>
  );
}
