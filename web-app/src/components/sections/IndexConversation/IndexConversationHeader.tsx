import LoadingText from "@/components/base/Loading";
import { useApi } from "@/context/APIContext";
import { useAuth } from "@/context/AuthContext";
import { useRole } from "@/hooks/useRole";
import { ITEM_STARRED, trackEvent } from "@/services/tracker";
import { toggleUserIndex, updateIndexTitle } from "@/store/api";
import { selectIndex } from "@/store/slices/indexSlice";
import { useAppDispatch, useAppSelector } from "@/store/store";
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
import { FC, useCallback } from "react";
import toast from "react-hot-toast";
import { maskDID } from "utils/helper";

export const IndexConversationHeader: FC = () => {
  const { isOwner } = useRole();
  const { session } = useAuth();
  const { api, ready: apiReady } = useApi();
  const dispatch = useAppDispatch();

  const { data: viewedIndex, titleLoading } = useAppSelector(selectIndex);

  const handleIndexToggle = useCallback(
    async (toggleType: "own" | "star") => {
      if (!api) return;

      const value =
        toggleType === "star"
          ? !viewedIndex?.did?.starred
          : !viewedIndex?.did?.owned;
      await dispatch(
        toggleUserIndex({
          indexID: viewedIndex?.id,
          api,
          toggleType,
          value,
        }),
      ).unwrap();

      toast.success(
        `Index ${value ? "added to" : "removed from"} starred indexes list`,
      );
      trackEvent(ITEM_STARRED);
    },
    [api, viewedIndex, dispatch],
  );

  const handleTitleChange = useCallback(
    async (title: string) => {
      if (!apiReady || !viewedIndex || !api) return;

      await dispatch(
        updateIndexTitle({ indexID: viewedIndex.id, title, api }),
      ).unwrap();

      toast.success("Index title updated");
    },
    [api, apiReady, viewedIndex, dispatch],
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
              loading={titleLoading}
            />
          </LoadingText>
        </Col>
        <Col className="mb-3 mr-2">
          {session && (
            <Tooltip content="Add to Starred Index">
              <Button
                iconHover
                theme="clear"
                onClick={() => {
                  handleIndexToggle("star");
                }}
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
              userIndexToggle={() => {
                handleIndexToggle("own");
              }}
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
