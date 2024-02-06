"use client";

import Avatar from "components/base/Avatar";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React from "react";
import { Indexes } from "types/entity";
import sanitize from "sanitize-html";
import cc from "classcat";
import { maskDID } from "utils/helper";
import Link from "next/link";
import cm from "./style.module.scss";

export interface IndexItemProps {
  index: Indexes;
  selected: boolean;
  onClick?(): Promise<void>;
}

const IndexItem: React.VFC<IndexItemProps> = ({ index, selected, onClick }) =>
  // const router = useRouter();
  // const { did } = router.query;
   (
    <Link href={`/discovery/${index.id}`}>
      <FlexRow
        className={cc([
          selected ? "index-list-item-selected" : "index-list-item",
          "p-6",
        ])}
        wrap={false}
        align={"center"}
      >
        <Col>
          <Avatar size={40} user={index.ownerDID} />
        </Col>
        <Col className="px-3">
          <Flex flexdirection={"column"}>
            <Text
              className={"my-0"}
              size="sm"
              verticalAlign="middle"
              fontWeight={500}
              element="p"
            >
              {index.ownerDID.name || maskDID(index.ownerDID.id!) || ""}
            </Text>
            <Header
              level={4}
              className={cm.title}
              dangerouslySetInnerHTML={{ __html: sanitize(index.title || "") }}
            ></Header>
          </Flex>
        </Col>
      </FlexRow>
    </Link>
  );
export default IndexItem;
