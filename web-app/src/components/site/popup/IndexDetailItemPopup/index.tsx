import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import IconTrash from "components/base/Icon/IconTrash";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";

export interface IndexDetailItemPopupProps {
  onDelete?(): void;
  children?: React.ReactNode;
}
const IndexDetailItemPopup = ({
  children,
  onDelete,
}: IndexDetailItemPopupProps) => {
  const handleDelete = () => {
    onDelete && onDelete();
  };

  return (
    <Dropdown
      position="bottom-right"
      menuItems={
        <DropdownMenuItem onClick={handleDelete}>
          <Flex alignitems="center">
            <IconTrash width={12} height="auto" className="icon-error" />
            <Text className="ml-3" element="span" size="sm" theme="error">
              {" "}
              Delete
            </Text>
          </Flex>
        </DropdownMenuItem>
      }
    >
      {children}
    </Dropdown>
  );
};

export default IndexDetailItemPopup;
