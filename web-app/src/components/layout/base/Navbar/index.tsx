import { IndexListTabKey, useApp } from "@/context/AppContext";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import cc from "classcat";
import Button from "components/base/Button";
import IconMenu from "components/base/Icon/IconMenu";
import LogoFull from "components/base/Logo/LogoFull";
import LogoMini from "components/base/Logo/LogoMini";
import { useYOffSet } from "hooks/useYOffset";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import Text from "../../../base/Text";
import Col from "../Grid/Col";
import Container from "../Grid/Container";
import Flex from "../Grid/Flex";
import FlexRow from "../Grid/FlexRow";

export interface NavbarProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  > {
  logoSize?: "full" | "mini";
  sticky?: boolean;
  stickyBgChangeAfter?: number;
  stickyBgColor?: string;
  bordered?: boolean;
  isLanding?: boolean;
  bgColor?: string;
}

export interface NavbarMenuProps
  extends React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  > {
  placement?: "left" | "right" | "center";
}

const Navbar = ({
  children,
  logoSize = "mini",
  sticky = false,
  stickyBgChangeAfter = 30,
  stickyBgColor = "#fff",
  bgColor,
  bordered = true,
  style,
  className,
  ...menuProps
}: NavbarProps) => {
  const yOffSet = useYOffSet(sticky);
  const [bgSticky, setBgSticky] = useState(false);

  const { session, status } = useAuth();
  const { isLanding } = useRouteParams();

  const router = useRouter();
  const { leftSidebarOpen, setLeftTabKey, setLeftSidebarOpen } = useApp();

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
    setLeftTabKey(IndexListTabKey.ALL);
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    } else {
      router.push(`/`);
    }
  };
  return (
    <>
      {isLanding && (
        <div
          style={{
            backgroundColor: "#f8f8f8",
            textAlign: "center",
            width: "100%",
            padding: "1em",
          }}
        >
          <Text className={"p-5"} size={"md"}>
            Index Network is live on testnet.
          </Text>
        </div>
      )}
      <div
        className={cc([
          className,
          "navbar-container",
          sticky ? "navbar-sticky" : "",
          bordered ? "navbar-bordered" : "",
        ])}
        style={
          sticky || bgColor
            ? {
                ...style,
                backgroundColor: sticky && bgSticky ? stickyBgColor : bgColor,
              }
            : style
        }
        {...menuProps}
      >
        <Container className="navbar" fluid={true}>
          <FlexRow fullWidth fullHeight align={"center"}>
            <Col xs={isLanding ? 10 : 12} centerBlock>
              <FlexRow justify="between" wrap={false}>
                <Col className={"navbar-logo"}>
                  <Flex alignitems={"center"}>
                    {logoSize === "mini" ? (
                      <LogoMini
                        className="navbar-logo"
                        onClick={handleLogoClick}
                        style={{
                          cursor: "pointer",
                        }}
                      />
                    ) : (
                      <LogoFull className="navbar-logo navbar-logo-full" />
                    )}
                  </Flex>
                </Col>
                <Col className={"navbar-sidebar-handlers"}>
                  {isLanding ? (
                    <LogoMini
                      onClick={handleLogoClick}
                      style={{
                        cursor: "pointer",
                      }}
                    />
                  ) : (
                    <Button
                      onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                      iconButton
                      theme="clear"
                    >
                      <IconMenu width={32} />
                    </Button>
                  )}
                </Col>
                <Col>{children}</Col>
              </FlexRow>
            </Col>
          </FlexRow>
        </Container>
      </div>
    </>
  );
};

export const NavbarMenu = ({
  className,
  children,
  placement = "left",
  ...props
}: NavbarMenuProps) => (
  <div {...props} className={cc([`navbar-menu-${placement}`, className || ""])}>
    {children}
  </div>
);

export default Navbar;
