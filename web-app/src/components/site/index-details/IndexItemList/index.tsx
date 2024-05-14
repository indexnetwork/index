import List from "components/base/List";
import { FC, memo } from "react";
import { useRole } from "hooks/useRole";
import InfiniteScroll from "react-infinite-scroll-component";
import { IndexItem, IndexTeamNodeItem, IndexWebPageItem } from "types/entity";

import NoLinks from "../../indexes/NoLinks";
import LinkItem from "../LinkItem";
import TeamItem from "../TeamItem";

export interface IndexItemListProps {
  search: string;
  items: IndexItem[];
  hasMore: boolean;
  removeItem: (item: IndexItem) => void;
  loadMore: () => void;
}

const MemoLinkItem = memo(LinkItem);
const MemoTeamItem = memo(TeamItem);

const IndexItemList: FC<IndexItemListProps> = ({
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
          hasMore={hasMore}
          next={loadMore}
          dataLength={items.length}
          height={"calc(100dvh - 34rem)"}
          loader={<div className="loader" key={0}></div>}
        >
          <List
            listClass="index-item-list"
            render={
              (item: IndexItem) =>
                item.type === "Team" ? (
                  <MemoTeamItem
                    handleRemove={() => removeItem(item)}
                    search={!!search}
                    item={item as IndexTeamNodeItem}
                  />
                ) : (
                  <MemoLinkItem
                    handleRemove={() => removeItem(item)}
                    search={!!search}
                    item={item as IndexWebPageItem}
                  />
                )
              // <MemoLinkItem
              //   handleRemove={() => removeItem(item)}
              //   search={!!search}
              //   item={item}
              // />
            }
            divided
            data={items}
          />
        </InfiniteScroll>
      )}
    </>
  );
};

export default IndexItemList;
