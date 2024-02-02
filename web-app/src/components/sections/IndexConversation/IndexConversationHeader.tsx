import { useApi } from "@/components/site/context/APIContext";
import { useApp } from "@/components/site/context/AppContext";
import { useAuth } from "@/components/site/context/AuthContext";
import { useRole } from "@/hooks/useRole";
import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import IconStar from "components/base/Icon/IconStar";
import Text from "components/base/Text";
import Tooltip from "components/base/Tooltip";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexTitleInput from "components/site/input/IndexTitleInput";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import moment from "moment";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Indexes } from "types/entity";
import { maskDID } from "utils/helper";

export const IndexConversationHeader: React.FC = () => {
  const { isOwner } = useRole();
  const { session } = useAuth();
  const { apiService: api } = useApi();
  const [titleLoading, setTitleLoading] = useState(false);
  const { viewedIndex, viewedProfile, setViewedIndex, indexes, setIndexes } =
    useApp();

  // if (!viewedIndex || !viewedProfile) return null;

  const handleTitleChange = useCallback(
    async (title: string) => {
      if (!api || !viewedIndex) return;

      setTitleLoading(true);
      try {
        const result = await api.updateIndex(viewedIndex.id, { title });
        setViewedIndex({ ...viewedIndex, title: result.title });
      } catch (error) {
        console.error("Error updating index", error);
      }
      setTitleLoading(false);
    },
    [viewedIndex, api, setViewedIndex],
  );

  const handleUserIndexToggle = useCallback(
    async (type: string, value: boolean) => {
      if (!api || !viewedIndex || !session) return;
      let updatedIndex: Indexes;
      try {
        if (type === "star") {
          await api?.starIndex(session!.did.parent, viewedIndex.id, value);
          updatedIndex = {
            ...viewedIndex,
            did: { ...viewedIndex.did, starred: value },
          };
        } else {
          await api?.ownIndex(session!.did.parent, viewedIndex.id, value);
          updatedIndex = {
            ...viewedIndex,
            did: { ...viewedIndex.did, owned: value },
          };
        }
      } catch (error) {
        console.error("Error updating index", error);
        return;
      }

      setViewedIndex(updatedIndex);
      setIndexes(
        indexes.map((index) =>
          index.id === updatedIndex.id ? updatedIndex : index,
        ),
      );
    },
    [viewedIndex, viewedProfile, api, setViewedIndex, indexes, setIndexes],
  );

  if (!viewedIndex) return null;

  return (
    <>
      <FlexRow>
        <Col centerBlock className="idxflex-grow-1">
          {viewedIndex && (
            <Link href={`/discovery/${viewedIndex.ownerDID?.id!}`}>
              <Avatar size={20} user={viewedIndex.ownerDID} />
              <Text
                className="ml-3"
                size="sm"
                verticalAlign="middle"
                fontWeight={500}
                element="span"
              >
                {viewedIndex.ownerDID?.name ||
                  (viewedIndex.ownerDID &&
                    maskDID(viewedIndex.ownerDID?.id!)) ||
                  ""}
              </Text>
            </Link>
          )}
        </Col>
      </FlexRow>

      <FlexRow className="pt-3">
        <Col className="idxflex-grow-1 mr-5">
          <IndexTitleInput
            defaultValue={viewedIndex?.title || ""}
            onChange={handleTitleChange}
            disabled={!isOwner}
            loading={titleLoading}
          />
        </Col>
        <Col className="mb-3 mr-2">
          <Tooltip content="Add to Starred Index">
            <Button
              iconHover
              theme="clear"
              onClick={() =>
                handleUserIndexToggle("star", !viewedIndex?.did?.starred)
              }
              borderless
            >
              <IconStar
                fill={
                  viewedIndex?.did?.starred ? "var(--main)" : "var(--white)"
                }
                width={20}
                height={20}
              />
            </Button>
          </Tooltip>
        </Col>
        <Col className="mb-3 ml-2">
          <Button iconHover theme="clear" borderless>
            <IndexOperationsPopup
              index={viewedIndex}
              userIndexToggle={() =>
                handleUserIndexToggle("own", !viewedIndex?.did.owned)
              }
            ></IndexOperationsPopup>
          </Button>
        </Col>
      </FlexRow>
      <FlexRow>
        <Text size="sm" theme="disabled">
          {viewedIndex?.updatedAt
            ? `Updated ${moment(viewedIndex?.updatedAt).fromNow()}`
            : ""}{" "}
        </Text>
      </FlexRow>
    </>
  );
};
