import List from "components/base/List";
import { FC, memo } from "react";
import { useRole } from "hooks/useRole";
import InfiniteScroll from "react-infinite-scroll-component";
import {
  DefaultIndexNodeItem,
  IndexIndexNodeItem,
  IndexItem,
  IndexTeamNodeItem,
  IndexWebPageItem,
} from "types/entity";

import NoLinks from "../../indexes/NoLinks";
import LinkItem from "../LinkItem";
import TeamItem from "../TeamItem";
import IndexIndexItem from "../IndexIndexItem";
import DefaultIndexItem from "../DefaultIndexItem";

export interface IndexItemListProps {
  search: string;
  items: IndexItem[];
  hasMore: boolean;
  removeItem: (item: IndexItem) => void;
  loadMore: () => void;
}

const MemoLinkItem = memo(LinkItem);
const MemoTeamItem = memo(TeamItem);
const MemoIndexItem = memo(IndexIndexItem);
const MemoDefaultIndexItem = memo(DefaultIndexItem);

const IndexItemList: FC<IndexItemListProps> = ({
  search,
  items,
  hasMore,
  loadMore,
  removeItem,
}) => {
  const { isOwner } = useRole();

  const render = (item: IndexItem) => {
    if (item.type === "Team") {
      return (
        <MemoTeamItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as IndexTeamNodeItem}
        />
      );
    }

    if (item.type === "WebPage") {
      return (
        <MemoLinkItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as IndexWebPageItem}
        />
      );
    }

    if (item.type === "Index") {
      return (
        <MemoIndexItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as IndexIndexNodeItem}
        />
      );
    }

    return (
      <MemoDefaultIndexItem
        handleRemove={() => removeItem(item)}
        search={!!search}
        item={item as DefaultIndexNodeItem}
      />
    );
  };

  return (
    <>
      {items.length === 0 ? (
        <NoLinks isOwner={isOwner} tabKey="items" search={search} />
      ) : (
        <InfiniteScroll
          hasMore={hasMore}
          next={loadMore}
          dataLength={items.length}
          height={"calc(100dvh - 34rem)"}
          loader={<div className="loader" key={0}></div>}
        >
          <List
            listClass="index-item-list"
            render={render}
            divided
            data={items}
          />
        </InfiniteScroll>
      )}
    </>
  );
};

export default IndexItemList;
