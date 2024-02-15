import { useRole } from "@/hooks/useRole";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import IconEmbed from "components/base/Icon/IconEmbed";
import IconRemove from "components/base/Icon/IconRemove";
import Text from "components/base/Text";
import React from "react";

export interface CreatorRulePopupPopupProps {
  onRemove: () => void;
  rule: any;
  children: React.ReactNode;
}
const CreatorRulePopup = ({
  children,
  rule,
  onRemove,
}: CreatorRulePopupPopupProps) => {
  const { isOwner } = useRole();
  const handleRemove = () => {
    onRemove && onRemove();
  };
  const handleEtherscan = () => {
    if (rule.contractAddress) {
      window.open(
        `https://etherscan.io/address/${rule.contractAddress}`,
        "_blank",
      );
    }
  };

  return (
    <Dropdown
      position="bottom-right"
      menuItems={
        <>
          <DropdownMenuItem onClick={handleEtherscan}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "start",
              }}
            >
              <IconEmbed width={20} height="auto" />
              <Text className="ml-3" element="span">
                View on Etherscan
              </Text>
            </div>
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem onClick={handleRemove}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "start",
                }}
              >
                <IconRemove height="auto" className="icon-error" />
                <Text className="ml-3" element="span" theme="error">
                  {" "}
                  {"Remove"}
                </Text>
              </div>
            </DropdownMenuItem>
          )}
        </>
      }
    >
      {children}
    </Dropdown>
  );
};

export default CreatorRulePopup;
