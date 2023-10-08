import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import React, { useEffect, useState } from "react";
import cc from "classcat";
import { useYOffSet } from "hooks/useYOffset";
import { useRouter } from "next/router";
import { useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import { useAuth } from "hooks/useAuth";
import IconMenu from "components/base/Icon/IconMenu";
import Button from "components/base/Button";
import { useApp } from "hooks/useApp";
import Container from "../Grid/Container";
import Col from "../Grid/Col";
import FlexRow from "../Grid/FlexRow";
import Flex from "../Grid/Flex";
import Text from "../../../base/Text";
import {appConfig} from "../../../../config";

export interface NavbarProps extends
	React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	logoSize?: "full" | "mini";
	sticky?: boolean;
	stickyBgChangeAfter?: number;
	stickyBgColor?: string;
	bordered?: boolean;
	isLanding?: boolean;
	bgColor?: string;
}

export interface NavbarMenuProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	placement?: "left" | "right" | "center";
}

const Navbar = (
	{
		children,
		logoSize = "mini",
		sticky = false,
		stickyBgChangeAfter = 30,
		stickyBgColor = "#fff",
		bgColor,
		bordered = true,
		style,
		className,
		isLanding,
		...menuProps
	}: NavbarProps,
) => {
	const yOffSet = useYOffSet(sticky);
	const [bgSticky, setBgSticky] = useState(false);

	const { did } = useAppSelector(selectConnection);
	const authenticated = useAuth();

	const router = useRouter();
	const { leftSidebarOpen, setLeftSidebarOpen } = useApp();

	/*
	const [showTestnetWarning, setShowTestnetWarning] = useState(false);
	useEffect(() => {
		const handleChainChanged = (newChainId: string) => setShowTestnetWarning(newChainId !== appConfig.testNetwork.chainId);
		handleChainChanged(window.ethereum?.chainId);
		window.ethereum?.on("chainChanged", handleChainChanged);
		return () => window.ethereum?.removeListener("chainChanged", handleChainChanged);
	}, []);
	 */

	useEffect(() => {
		if (sticky) {
			if (typeof yOffSet === "number") {
				if (yOffSet > stickyBgChangeAfter) {
					!bgSticky && setBgSticky(true);
				} else {
					bgSticky && setBgSticky(false);
				}
			}
		}
	}, [bgSticky, sticky, stickyBgChangeAfter, stickyBgColor, yOffSet]);

	const handleLogoClick = () => {
		if (authenticated) {
			router.push(`/[did]`, `/${did}`, { shallow: true });
		} else {
			router.push(`/`);
		}
	};
	return (
		<>
			{isLanding && <Flex alignItems={"center"} justifyContent={"space-around"} style={{ background: "var(--landing)" }}>
				<Text className={"p-5"} size={"md"}>Index Network is live on testnet.</Text>
			</Flex>}
			<div
				className={cc([
					className,
					"navbar-container",
					sticky ? "navbar-sticky" : "",
					bordered ? "navbar-bordered" : "",
				])}
				style={sticky || bgColor ? {
					...style,
					backgroundColor: sticky && bgSticky ? stickyBgColor : bgColor,
				} : style}
				{...menuProps}
			>
				<Container
					className="navbar"
					fluid={true}
				>
					<FlexRow fullWidth fullHeight align={"center"}>
						<Col xs={isLanding ? 10 : 12} centerBlock>
							<FlexRow
								justify="between"
								wrap={false}
							>
								<Col className={"navbar-logo"}>
									<Flex alignItems={"center"}>
										{logoSize === "mini" ? <LogoMini className="navbar-logo" onClick={handleLogoClick} style={{
											cursor: "pointer",
										}} /> : <LogoFull className="navbar-logo navbar-logo-full" />}
									</Flex>
								</Col>
								<Col className={"navbar-sidebar-handlers"}>
									<Button onClick={() => setLeftSidebarOpen(!leftSidebarOpen)} iconButton theme="clear"><IconMenu width={32} /></Button>
								</Col>
								<Col>
									{children}
								</Col>
							</FlexRow>
						</Col>
					</FlexRow>
				</Container>
			</div>
		</>
	);
};

export const NavbarMenu = (
	{
		className,
		children,
		placement = "left",
		...props
	}: NavbarMenuProps,
) => <div {...props} className={cc([`navbar-menu-${placement}`, className || ""])}>{children}</div>;

export default Navbar;
