import List from "components/base/List";
import React from "react";
import InfiniteScroll from "react-infinite-scroller";
import { useLinks } from "hooks/useLinks";
import LinkItem from "../LinkItem";
import NoLinks from "../../indexes/NoLinks";
import { UserRole, useRole } from "hooks/useRole";

export interface LinkListProps {
  indexId: string;
  search: string;
}

const MemoLinkItem = React.memo(LinkItem);

const IndexItemList: React.VFC<LinkListProps> = ({ search, indexId }) => {
  const {
    links, setLinks, hasMore, loadMore,
  } = useLinks();

  const {isOwner, role} = useRole();

  return (
    <>
      {
        links.length === 0 ? (
          <NoLinks isOwner={isOwner} tabKey={"items"} search={search}></NoLinks>
        ) : (
          <InfiniteScroll className={"scrollable-area idxflex-grow-1 pb-6"} useWindow={false} hasMore={hasMore} loadMore={loadMore!} marginHeight={50}>
            <List
              listClass="index-item-list "
              render={(item) => <MemoLinkItem
                search={!!search}
                index_link={item}
              />}
              divided
              data={links}
            />
          </InfiniteScroll>
        )
      }
    </>

  );
};

export default IndexItemList;
