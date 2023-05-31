import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React from "react";
import IconRemove from "components/base/Icon/IconRemove";
import IconEmbed from "components/base/Icon/IconEmbed";

export interface CreatorRulePopupPopupProps {
	onDelete?(): void;
	children: React.ReactNode;
}
const CreatorRulePopup = (
	{
		children,
		onDelete,
	}: CreatorRulePopupPopupProps,
) => {
	const { t } = useTranslation("common");
	const handleDelete = () => {
		onDelete && onDelete();
	};

	return (
		<Dropdown
			position="bottom-right"
			menuItems={
				<>
					<DropdownMenuItem onClick={handleDelete}>
						<Flex alignItems="center">
							<IconEmbed width={20} height="auto" className="icon-" />
							<Text className="ml-3" element="span" > View on Etherscan</Text>
						</Flex>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleDelete}>
						<Flex alignItems="center">
							<IconRemove height="auto" className="icon-error" />
							<Text className="ml-3" element="span" theme="error" > {t("remove")}</Text>
						</Flex>
					</DropdownMenuItem>
				</>
			}
		>
			{children}
		</Dropdown>
	);
};

export default CreatorRulePopup;
