import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import { copyToClipboard } from "utils/helper";
import { IconTrash } from "@/components/ai/ui/icons";

export interface HistoryItemOpsPopupProps {}

const HistoryItemOpsPopup: React.FC<HistoryItemOpsPopupProps> = () => (
  <div
    style={{
      zIndex: 99,
    }}
  >
    <Dropdown
      menuClass="index-list-item-menu ml-6"
      position="bottom-right"
      menuItems={
        <>
          <DropdownMenuItem
            onClick={(e: any) => {
              e.stopPropagation();
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
              <IconTrash />
              <Text className="ml-3" element="span" size="md">
                Delete
              </Text>
            </div>
          </DropdownMenuItem>
        </>
      }
    >
      <IconContextMenu
        width={20}
        height={20}
        className="index-list-item-menu-btn"
      />
    </Dropdown>
  </div>
);

export default HistoryItemOpsPopup;
