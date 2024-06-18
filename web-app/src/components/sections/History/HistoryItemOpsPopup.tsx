import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import { IconTrash } from "@/components/ai/ui/icons";

export interface HistoryItemOpsPopupProps {
  onDelete: () => void;
}

const HistoryItemOpsPopup: React.FC<HistoryItemOpsPopupProps> = ({
  onDelete,
}) => (
  <div
    style={{
      zIndex: 9,
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
              onDelete();
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "start",
                color: "red",
              }}
            >
              <IconTrash />
              <Text
                style={{
                  color: "red",
                }}
                className="ml-3"
                element="span"
                size="md"
              >
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
