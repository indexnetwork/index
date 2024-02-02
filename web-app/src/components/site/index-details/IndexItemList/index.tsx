import React from "react";
import List from "components/base/List";
import InfiniteScroll from "react-infinite-scroller";
import LinkItem from "../LinkItem";
import NoLinks from "../../indexes/NoLinks";
import { IndexItem } from "types/entity";
import { useRole } from "hooks/useRole";

export interface IndexItemListProps {
  search: string;
  items: IndexItem[];
  hasMore: boolean;
  removeItem: (item: IndexItem) => void;
  loadMore: () => void;
}

const MemoLinkItem = React.memo(LinkItem);

const IndexItemList: React.VFC<IndexItemListProps> = ({
  search,
  items,
  hasMore,
  loadMore,
  removeItem,
}) => {
  const { isOwner } = useRole();

  return (
    <>
      {items.length === 0 ? (
        <NoLinks isOwner={isOwner} tabKey="items" search={search} />
      ) : (
        <InfiniteScroll
          className="scrollable-area idxflex-grow-1 pb-6"
          useWindow={false}
          hasMore={hasMore}
          loadMore={loadMore}
          marginHeight={50}
        >
          <List
            listClass="index-item-list"
            render={(item: IndexItem) => (
              <MemoLinkItem
                handleRemove={() => removeItem(item)}
                search={!!search} item={item} />
            )}
            divided
            data={items}
          />
        </InfiniteScroll>
      )}
    </>
  );
};

export default IndexItemList;
