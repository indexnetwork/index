import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React from "react";
import IconRemove from "components/base/Icon/IconRemove";
import IconEmbed from "components/base/Icon/IconEmbed";
import { useIndex } from "hooks/useIndex";

export interface CreatorRulePopupPopupProps {
	onRemove: () => void;
	rule: any;
	children: React.ReactNode;
}
const CreatorRulePopup = (
	{
		children,
		rule,
		onRemove,
	}: CreatorRulePopupPopupProps,
) => {
	const { t } = useTranslation("common");
	const { isOwner } = useIndex();
	const handleRemove = () => {
		onRemove && onRemove();
	};
	const handleEtherscan = () => {
		if (rule.contractAddress) {
			window.open(`https://etherscan.io/address/${rule.contractAddress}`, "_blank");
		}
	};

	return (
		<Dropdown
			position="bottom-right"
			menuItems={
				<>
					<DropdownMenuItem onClick={handleEtherscan}>
						<Flex alignItems="center">
							<IconEmbed width={20} height="auto"/>
							<Text className="ml-3" element="span" >View on Etherscan</Text>
						</Flex>
					</DropdownMenuItem>
					{isOwner && <DropdownMenuItem onClick={handleRemove}>
						<Flex alignItems="center">
							<IconRemove height="auto" className="icon-error" />
							<Text className="ml-3" element="span" theme="error" > {t("remove")}</Text>
						</Flex>
					</DropdownMenuItem>}
				</>
			}
		>
			{children}
		</Dropdown>
	);
};

export default CreatorRulePopup;
