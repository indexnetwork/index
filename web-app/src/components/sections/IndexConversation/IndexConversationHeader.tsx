import LoadingText from "@/components/base/Loading";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useRouteParams } from "@/hooks/useRouteParams";
import { ITEM_STARRED, trackEvent } from "@/services/tracker";
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
import { useRouter } from "next/navigation";
import { FC, useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Indexes } from "types/entity";
import { maskDID } from "utils/helper";
import { useIndexConversation } from "./IndexConversationContext";
import { useAppSelector } from "@/store/store";
import { selectIndex } from "@/store/slices/indexSlice";

export const IndexConversationHeader: FC = () => {
  const { isConversation } = useRouteParams();
  const { isOwner } = useRole();
  const { session } = useAuth();
  const { api, ready: apiReady } = useApi();
  const router = useRouter();
  const { loading: indexLoading } = useIndexConversation();

  const { data: viewedIndex } = useAppSelector(selectIndex);

  const [titleLoading, setTitleLoading] = useState(false);
  const { setViewedIndex, viewedProfile, indexes, setIndexes, fetchIndexes } =
    useApp();

  const handleTitleChange = useCallback(
    async (title: string) => {
      if (!apiReady || !viewedIndex) return;

      setTitleLoading(true);
      try {
        const result = await api!.updateIndex(viewedIndex.id, { title });
        const updatedIndex = {
          ...viewedIndex,
          title: result.title,
          updatedAt: result.updatedAt,
        };
        setViewedIndex(updatedIndex);
        const updatedIndexes = indexes.map((i) =>
          i.id === viewedIndex.id ? { ...i, title: result.title } : i,
        );

        setIndexes(updatedIndexes);
        toast.success("Index title updated");
      } catch (error) {
        console.error("Error updating index", error);
        toast.error("Error updating index");
      } finally {
        setTitleLoading(false);
      }
    },
    [api, viewedIndex, indexes, setIndexes, apiReady, setViewedIndex],
  );

  const handleUserIndexToggle = useCallback(
    async (type: string, value: boolean) => {
      if (!apiReady || !viewedIndex || !viewedProfile || !session) return;
      let updatedIndex: Indexes;

      try {
        if (type === "star") {
          await api!.starIndex(session!.did.parent, viewedIndex.id, value);
          updatedIndex = {
            ...viewedIndex,
            did: { ...viewedIndex.did, starred: value },
          };
          setViewedIndex(updatedIndex);
          toast.success(
            `Index ${value ? "added to" : "removed from"} starred indexes list`,
          );
          trackEvent(ITEM_STARRED);
        } else {
          await api!.ownIndex(session!.did.parent, viewedIndex.id, value);
          if (value) {
            updatedIndex = {
              ...viewedIndex,
              did: { ...viewedIndex.did, owned: value },
            };
            setViewedIndex(updatedIndex);
          } else {
            router.push(`/${viewedProfile.id}`);
          }
          toast.success(
            `Index ${value ? "added to" : "removed from"} your indexes list`,
          );
        }
      } catch (error) {
        console.error("Error updating index", error);
        toast.error("Error updating index");
        return;
      }

      fetchIndexes(viewedProfile.id);
    },
    [api, session, viewedIndex, apiReady, setViewedIndex, indexes, setIndexes],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FlexRow>
        <Col centerBlock className="idxflex-grow-1">
          {
            <Link
              style={{
                display: "flex",
                width: "fit-content",
              }}
              href={`/${viewedIndex?.controllerDID?.id!}`}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.8em" }}
              >
                <Avatar size={20} user={viewedIndex?.controllerDID} />
                <LoadingText
                  val={
                    viewedIndex?.controllerDID?.name ||
                    viewedIndex?.controllerDID?.id
                  }
                >
                  <Text
                    size="sm"
                    verticalAlign="middle"
                    fontWeight={500}
                    element="span"
                  >
                    {viewedIndex?.controllerDID?.name ||
                      (viewedIndex?.controllerDID &&
                        maskDID(viewedIndex?.controllerDID?.id!)) ||
                      ""}
                  </Text>
                </LoadingText>
              </div>
            </Link>
          }
        </Col>
      </FlexRow>

      <FlexRow className="pt-3">
        <Col className="idxflex-grow-1 mr-5">
          <LoadingText val={viewedIndex?.title}>
            <IndexTitleInput
              defaultValue={viewedIndex?.title || ""}
              onChange={handleTitleChange}
              disabled={!isOwner}
              loading={titleLoading || indexLoading}
            />
          </LoadingText>
        </Col>
        <Col className="mb-3 mr-2">
          {session && (
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
          )}
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
        <LoadingText val={viewedIndex?.updatedAt}>
          <Text size="sm" theme="disabled">
            {viewedIndex?.updatedAt
              ? `Updated ${moment(viewedIndex?.updatedAt).fromNow()}`
              : ""}{" "}
          </Text>
        </LoadingText>
      </FlexRow>
    </div>
  );
};
