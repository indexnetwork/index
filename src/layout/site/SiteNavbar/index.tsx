import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Text from "components/base/Text";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import IconPeople from "components/base/Icon/IconPeople";
import Flex from "layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React, { useCallback } from "react";
import IconSettings from "components/base/Icon/IconSettings";
import IconLogout from "components/base/Icon/IconLogout";
import Navbar, { NavbarProps, NavbarMenu } from "../../base/Navbar";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
	isLanding?: boolean;
}

const SiteNavbar: React.FC<LandingHeaderProps> = ({ headerType, isLanding = false, ...baseProps }) => {
	const { t } = useTranslation(["common", "components"]);

	const renderHeader = useCallback(() => (headerType === "public" ? (
		<Navbar
			className="site-navbar"
			logoSize="full"
			sticky
			bgColor={isLanding ? "#f4fbf6" : undefined}
			bordered={false}
			{...baseProps}
		>
			<NavbarMenu placement="right">
				<Button theme="ghost">{t("common:signIn")}</Button>
				<Button theme="primary">{t("common:signUp")}</Button>
			</NavbarMenu>
		</Navbar>
	) : (
		<Navbar
			className="site-navbar"
			logoSize="mini"
			{...baseProps}
		>
			<NavbarMenu>
				<Button theme="primary">{t("components:header.newIndexBtn")}</Button>
				<Dropdown
					menuClass="idx-ml-6 idx-ml-lg-7"
					position="bottom-right"
					menuItems={
						<>
							<DropdownMenuItem>
								<Flex alignItems="center">
									<IconPeople width={12} height="100%" />
									<Text className="idx-ml-3" element="span" size="sm" theme="secondary">&nbsp;{t("common:profile")}</Text>
								</Flex>
							</DropdownMenuItem>
							<DropdownMenuItem>
								<Flex alignItems="center">
									<IconSettings width={12} height="100%" />
									<Text className="idx-ml-3" element="span" size="sm" theme="secondary">&nbsp;{t("common:settings")}</Text>
								</Flex>
							</DropdownMenuItem>
							<DropdownMenuItem divider />
							<DropdownMenuItem>
								<Flex alignItems="center">
									<IconLogout className="idx-icon-error" width={12} height="100%" />
									<Text className="idx-ml-3" element="span" size="sm" theme="error">&nbsp;{t("common:logout")}</Text>
								</Flex>
							</DropdownMenuItem>
						</>
					}
				>
					<Avatar className="site-navbar__avatar" hoverable size={28} randomColor>S</Avatar>
				</Dropdown>
			</NavbarMenu>
		</Navbar>
	)), [headerType, baseProps, isLanding, t]);

	return renderHeader();
};

export default SiteNavbar;
