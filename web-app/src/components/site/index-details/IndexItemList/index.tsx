import List from "components/base/List";
import { FC, memo } from "react";
import { useRole } from "hooks/useRole";
import InfiniteScroll from "react-infinite-scroll-component";
import {
  CastIndexNodeItem,
  DefaultIndexNodeItem,
  IndexIndexNodeItem,
  IndexItem,
  IndexTeamNodeItem,
  IndexWebPageItem,
  ArticleIndexNodeItem,
} from "types/entity";

import NoLinks from "../../indexes/NoLinks";
import LinkItem from "../LinkItem";
import TeamItem from "../TeamItem";
import IndexIndexItem from "../IndexIndexItem";
import DefaultIndexItem from "../DefaultIndexItem";
import CastItem from "../CastItem";
import ArticleItem from "../ArticleItem";
import AttestationItem from "../AttestationItem";

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
const MemoCastItem = memo(CastItem);
const MemoArticleItem = memo(ArticleItem);
const MemoAttestationItem = memo(AttestationItem);

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

    if (item.type === "Article") {
      return (
        <MemoArticleItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as ArticleIndexNodeItem}
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

    if (item.type === "Attestation") {
      return (
        <MemoAttestationItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as IndexIndexNodeItem}
        />
      );
    }

    if (item.type === "Cast") {
      return (
        <MemoCastItem
          handleRemove={() => removeItem(item)}
          search={!!search}
          item={item as CastIndexNodeItem}
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
      {items && items.length === 0 ? (
        <NoLinks isOwner={isOwner} tabKey="items" search={search} />
      ) : (
        <InfiniteScroll
          hasMore={hasMore}
          next={loadMore}
          dataLength={items && items.length}
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
