import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Text from "components/base/Text";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";

import IconPeople from "components/base/Icon/IconPeople";
import Flex from "components/layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React, {
	useCallback, useContext,
} from "react";
import IconDisconnect from "components/base/Icon/IconDisconnect";
import { AuthHandlerContext } from "components/site/context/AuthHandlerProvider";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { useAuth } from "hooks/useAuth";
import { selectProfile } from "store/slices/profileSlice";
import { appConfig } from "config";
import IconSettings from "components/base/Icon/IconSettings";
import Navbar, { NavbarProps, NavbarMenu } from "components/layout/base/Navbar";
import { useApp } from "hooks/useApp";
import { useRouter } from "next/router";

export interface LandingHeaderProps extends NavbarProps {
	headerType: "public" | "user";
	isLanding?: boolean;
}

const SiteNavbar = (
	{
		headerType = "user",
		isLanding = false,
		...baseProps
	}: LandingHeaderProps,
) => {
	const { t } = useTranslation(["common", "components"]);
	const router = useRouter();
	const {
		did,
		loading,
	} = useAppSelector(selectConnection);

	const {
		available,
		name,
		pfp,
	} = useAppSelector(selectProfile);

	const authenticated = useAuth();
	const { connect, disconnect } = useContext(AuthHandlerContext);
	const handleConnect = async () => {
		try {
			await connect();
		} catch (err) {
			console.log(err);
		}
	};

	const { setCreateModalVisible } = useApp();

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
				{(loading && isLanding) ? (
					<Button
						theme="primary"
						className="lottie-text"
						loading={true}
					>
						{"Connecting"}
					</Button>
				) : (
					<Button
						theme="primary"
						onClick={handleConnect}
					>{t("common:connect")}</Button>
				)}
			</NavbarMenu>
		</Navbar>
	) : (
		<Navbar
			className="site-navbar"
			logoSize="mini"
			{...baseProps}
		>
			{
				authenticated ? (
					<NavbarMenu>
						<Button className="pr-5 pl-5" onClick={() => { setCreateModalVisible(true); }} theme="primary">{t("components:header.newIndexBtn")}</Button>
						<Dropdown
							dropdownClass="ml-6"
							position="bottom-right"
							menuItems={
								<>
									<DropdownMenuItem onClick={() => {
										router.push("/profile/view");
									}}>
										<Flex alignItems="center">
											<IconPeople width={16} height="100%"/>
											<Text className="ml-3" element="span" size="md" >{t("common:profile")}</Text>
										</Flex>
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => {
										router.push("/profile");
									}}>
										<Flex alignItems="center">
											<IconSettings width={16} height="100%"/>
											<Text className="ml-3" element="span" size="md" >Profile Settings</Text>
										</Flex>
									</DropdownMenuItem>
									{/* <DropdownMenuItem>
									<Flex alignItems="center">
										<IconSettings width={12} height="100%" />
										<Text className="ml-3" element="span" size="sm" theme="secondary">{t("common:settings")}</Text>
									</Flex>
								</DropdownMenuItem> */}
									<DropdownMenuItem divider/>
									<DropdownMenuItem onClick={disconnect}>
										<Flex alignItems="center">
											<IconDisconnect className="icon-error" width={16} height="100%"/>
											<Text className="ml-3 dropdown-text-logout" element="span" size="md" theme="error">{t("common:disconnect")}</Text>
										</Flex>
									</DropdownMenuItem>
								</>
							}
						>
							<Avatar className="site-navbar__avatar" hoverable size={32} randomColor>{
								pfp ?
									<img src={pfp.replace("ipfs://", appConfig.ipfsProxy)} alt="profile_img"/> : (
										available && name ? name : "Y"
									)}</Avatar>
						</Dropdown>
					</NavbarMenu>
				) :
					(
						<NavbarMenu placement="right">
							<Button
								theme="primary"
								onClick={handleConnect}
							>{t("common:connect")}</Button>
						</NavbarMenu>
					)
			}
		</Navbar>
	)), [headerType, baseProps, isLanding, t]);

	return renderHeader();
};

export default SiteNavbar;
