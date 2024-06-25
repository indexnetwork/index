import SearchInput from "@/components/base/SearchInput";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import IndexItemList from "@/components/site/index-details/IndexItemList";
import LinkInput from "@/components/site/input/LinkInput";
import { useApi } from "@/context/APIContext";
import { useRole } from "@/hooks/useRole";
import { ITEM_ADDED, trackEvent } from "@/services/tracker";
import { addItem, removeItem } from "@/store/api/index";
import { selectIndex, setAddItemLoading } from "@/store/slices/indexSlice";
import { useAppDispatch, useAppSelector } from "@/store/store";
import { IndexItem } from "@/types/entity";
import { filterValidUrls, isStreamID, removeDuplicates } from "@/utils/helper";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { useIndexConversation } from "../IndexConversationContext";

const CONCURRENCY_LIMIT = 10;

export default function IndexItemsTabSection() {
  const {
    setItemsState,
    loading,
    setLoading,
    searchLoading,
    fetchIndexItems,
    fetchMoreIndexItems,
  } = useIndexConversation();
  const { isCreator } = useRole();
  const {
    data: viewedIndex,
    items,
    addItemLoading,
  } = useAppSelector(selectIndex);
  const dispatch = useAppDispatch();

  const { api, ready: apiReady } = useApi();
  const [search, setSearch] = useState("");
  const [addedItem, setAddedItem] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // useEffect(() => {
  //   if (addedItem) {
  //     setItemsState({
  //       items: [addedItem, ...itemsState.items],
  //       cursor: itemsState.cursor,
  //     });
  //   }

  //   setProgress({
  //     ...progress,
  //     current: progress.current + 1,
  //   });

  //   if (progress.current === progress.total) {
  //     setLoading(false);
  //     setProgress({ current: 0, total: 0 });
  //   }
  // }, [addedItem, setItemsState]);

  // const handleSearch = useCallback(
  //   (searchQuery: string) => {
  //     if (!viewedIndex) return;
  //     setSearch(searchQuery);
  //     fetchIndexItems(viewedIndex?.id, {
  //       resetCursor: true,
  //       params: { query: searchQuery },
  //     });
  //   },
  //   [fetchIndexItems],
  // );

  const processUrlsInBatches = async (urls, processUrl) => {
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
    async (inputItems: any) => {
      if (!apiReady || !viewedIndex || !api) return;

      // Add only unique and valid URLs
      const filteredUrls = filterValidUrls(inputItems);
      const uniqueUrls = removeDuplicates(filteredUrls);
      const urls = removeDuplicates(
        uniqueUrls,
        items.data.filter((i) => i.type === "WebPage").map((i) => i.node.url),
      );

      // Add only unique and valid indexes
      const inputIndexIds = inputItems.filter((id) => isStreamID(id));
      const uniqueIndexIds = removeDuplicates(inputIndexIds);
      const indexIds = removeDuplicates(
        uniqueIndexIds,
        items.data.filter((i) => i.type === "Index").map((i) => i.node.id),
      );

      const updatedItems = [...urls, ...indexIds];

      dispatch(setAddItemLoading(true));
      setProgress({ current: 0, total: updatedItems.length });

      await processUrlsInBatches(updatedItems, async (item) => {
        try {
          await dispatch(
            addItem({
              item,
              api,
              indexID: viewedIndex.id,
            }),
          ).unwrap();
          trackEvent(ITEM_ADDED);
        } catch (error) {
          console.error("Error adding item", error);
          toast.error(`Error adding item: ${item}`);
        }
      });

      dispatch(setAddItemLoading(false));
    },
    [api, viewedIndex, apiReady, items, dispatch],
  );

  const handleRemoveItem = useCallback(
    async (item: IndexItem) => {
      if (!apiReady || !viewedIndex || !api) return;

      dispatch(setAddItemLoading(true));
      try {
        await dispatch(
          removeItem({
            item: item.node.id,
            api,
            indexID: viewedIndex.id,
          }),
        ).unwrap();
      } catch (error) {
        console.error("Error removing item", error);
        toast.error(`Error removing item: ${item.id}`);
      } finally {
        dispatch(setAddItemLoading(false));
      }
    },
    [api, viewedIndex, apiReady, fetchIndexItems],
  );

  // const handleRemove = useCallback(
  //   (item: IndexItem) => {
  //     if (!apiReady || !viewedIndex) return;
  //     setLoading(true);
  //     api!
  //       .deleteItem(viewedIndex.id, item.node.id)
  //       .then(() => {
  //         setItemsState({
  //           items: itemsState.items.filter((i) => i.node.id !== item.node.id),
  //           cursor: itemsState.cursor,
  //         });
  //         toast.success("Item deleted successfully");
  //       })
  //       .catch((error) => {
  //         console.error("Error deleting item", error);
  //         toast.error("Error deleting item");
  //       })
  //       .finally(() => setLoading(false));
  //   },
  //   [
  //     api,
  //     apiReady,
  //     viewedIndex,
  //     setItemsState,
  //     itemsState.cursor,
  //     itemsState.items,
  //     setLoading,
  //   ],
  // );

  return (
    <Flex flexdirection="column" className="idxflex-grow-1">
      {items.data.length > 0 && (
        <FlexRow className={"mt-6"}>
          <Col className="idxflex-grow-1">
            <SearchInput
              // onSearch={handleSearch}
              debounceTime={300}
              showClear
              defaultValue={search}
              loading={searchLoading}
              placeholder="Search in this index"
            />
          </Col>
        </FlexRow>
      )}

      {isCreator && (
        <FlexRow>
          <Col className="idxflex-grow-1 mt-6 pb-0">
            <LinkInput
              loading={addItemLoading}
              onItemAdd={handleAddItem}
              progress={progress}
            />
          </Col>
        </FlexRow>
      )}

      <div key={viewedIndex?.id} className={"mb-4 mt-6"}>
        <IndexItemList
          items={items.data}
          search={search}
          hasMore={!!items.cursor}
          removeItem={handleRemoveItem}
          loadMore={() =>
            viewedIndex &&
            fetchMoreIndexItems(viewedIndex?.id, { resetCursor: false })
          }
        />
      </div>
    </Flex>
  );
}
