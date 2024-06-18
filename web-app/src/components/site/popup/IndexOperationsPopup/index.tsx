import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import IconCopy from "components/base/Icon/IconCopy";
import { copyToClipboard } from "utils/helper";
import IconRemove from "components/base/Icon/IconRemove";
import IconAddCircle from "components/base/Icon/IconAddCircle";
import { Indexes } from "types/entity";

export interface IndexOperationsPopupProps {
  index?: Indexes;
  userIndexToggle(): void;
  isConversation?: boolean;
}

const IndexOperationsPopup: React.FC<IndexOperationsPopupProps> = ({
  index,
  userIndexToggle,
  isConversation,
}) => (
  <Dropdown
    menuClass="index-list-item-menu ml-6"
    position="bottom-right"
    menuItems={
      <>
        <DropdownMenuItem
          onClick={() => {
            copyToClipboard(`${window.location.href}`);
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "start",
            }}
          >
            <IconCopy />
            <Text className="ml-3" element="span" size="md">
              Copy Link
            </Text>
          </div>
        </DropdownMenuItem>

        {index?.roles?.owner &&
          (index?.did?.owned ? (
            <>
              <DropdownMenuItem divider />
              <DropdownMenuItem onClick={userIndexToggle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "start",
                  }}
                >
                  <IconRemove />
                  <Text className="ml-3" theme="error" element="span" size="md">
                    Remove
                  </Text>
                </div>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem divider />
              <DropdownMenuItem onClick={userIndexToggle}>
                <Flex alignitems="center">
                  <IconAddCircle />
                  <Text className="ml-3" element="span" size="md">
                    Add to my indexes
                  </Text>
                </Flex>
              </DropdownMenuItem>
            </>
          ))}
        {isConversation && (
          <DropdownMenuItem
            onClick={() => {
              console.log("click");
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "start",
              }}
            >
              <IconCopy />
              <Text className="ml-3" element="span" size="md">
                New Chat
              </Text>
            </div>
          </DropdownMenuItem>
        )}
      </>
    }
  >
    <IconContextMenu
      width={20}
      height={20}
      className="index-list-item-menu-btn"
    />
  </Dropdown>
);

export default IndexOperationsPopup;
