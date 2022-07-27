import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Text from "components/base/Text";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import IconPeople from "components/base/Icon/IconPeople";
import Flex from "components/layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React, { useCallback, useContext, useEffect } from "react";
import IconSettings from "components/base/Icon/IconSettings";
import IconLogout from "components/base/Icon/IconLogout";
import Router, { useRouter } from "next/router";
import { AuthHandlerContext } from "components/site/context/AuthHandlerProvider";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { useAuth } from "hooks/useAuth";
import { selectProfile } from "store/slices/profileSlice";
import Navbar, { NavbarProps, NavbarMenu } from "../../base/Navbar";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
	isLanding?: boolean;
}

const SiteNavbar: React.FC<LandingHeaderProps> = ({ headerType = "user", isLanding = false, ...baseProps }) => {
	const { t } = useTranslation(["common", "components"]);

	const {
		address,
	} = useAppSelector(selectConnection);

	const {
		available,
		name,
		image,
	} = useAppSelector(selectProfile);

	const authenticated = useAuth();

	const { connect, disconnect } = useContext(AuthHandlerContext);

	const router = useRouter();

	const handleCreate = () => {
		router.push("/create");
	};

	useEffect(() => {
		if (isLanding && authenticated) {
			Router.push(`/${address}`);
		}
	}, [address, authenticated, isLanding]);

	const handleConnect = async () => {
		try {
			await connect("injected");
		} catch (err) {
			console.log(err);
		}
	};

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
				<Button
					theme="primary"
					onClick={handleConnect}
				>{t("common:connect")}</Button>
			</NavbarMenu>
		</Navbar>
	) : (
		<Navbar
			className="site-navbar"
			logoSize="mini"
			{...baseProps}
		>
			{
				authenticated &&
				<NavbarMenu>
					<Button onClick={handleCreate} theme="primary">{t("components:header.newIndexBtn")}</Button>
					<Dropdown
						dropdownClass="idx-ml-6 idx-ml-lg-7"
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
								<DropdownMenuItem onClick={disconnect}>
									<Flex alignItems="center">
										<IconLogout className="idx-icon-error" width={12} height="100%" />
										<Text className="idx-ml-3" element="span" size="sm" theme="error">&nbsp;{t("common:logout")}</Text>
									</Flex>
								</DropdownMenuItem>
							</>
						}
					>
						<Avatar className="site-navbar__avatar" hoverable size={28} randomColor>{
							available && image && image.alternatives ? <img src={image.alternatives[0].src.replace("ipfs://", "https://ipfs.io/ipfs/")} alt="profile_img" /> : (
								available && name ? name : "Y"
							)}</Avatar>
					</Dropdown>
				</NavbarMenu>
			}
		</Navbar>
	)), [headerType, baseProps, isLanding, t]);

	return renderHeader();
};

export default SiteNavbar;
