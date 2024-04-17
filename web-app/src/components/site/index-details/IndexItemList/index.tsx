import List from "components/base/List";
import React from "react";
import InfiniteScroll from "react-infinite-scroller";
import { useRole } from "hooks/useRole";
import { IndexItem } from "types/entity";
// import InfiniteScroll from "react-infinite-scroll-component";

import NoLinks from "../../indexes/NoLinks";
import LinkItem from "../LinkItem";

export interface IndexItemListProps {
  search: string;
  items: IndexItem[];
  hasMore: boolean;
  removeItem: (item: IndexItem) => void;
  loadMore: () => void;
}

const MemoLinkItem = React.memo(LinkItem);

const IndexItemList: React.FC<IndexItemListProps> = ({
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
          // loader={<div className="loader" key={0}></div>}
        >
          <List
            listClass="index-item-list"
            render={(item: IndexItem) => (
              <MemoLinkItem
                handleRemove={() => removeItem(item)}
                search={!!search}
                item={item}
              />
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
