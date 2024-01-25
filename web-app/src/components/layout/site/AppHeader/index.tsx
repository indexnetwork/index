import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Text from "components/base/Text";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";

import Flex from "components/layout/base/Grid/Flex";
import { useTranslation } from "next-i18next";
import React, { useCallback, useContext, useMemo } from "react";
import IconDisconnect from "components/base/Icon/IconDisconnect";
import { AuthContext, AuthStatus } from "components/site/context/AuthContext";
import { useAppSelector } from "hooks/store";
import { selectProfile } from "store/slices/profileSlice";
import IconSettings from "components/base/Icon/IconSettings";
import Navbar, { NavbarMenu } from "components/layout/base/Navbar";
import { useApp } from "hooks/useApp";
import IconHistory from "components/base/Icon/IconHistory";
import { usePathname } from "next/navigation";


const AppHeader = () => {
  const { t } = useTranslation(["common", "components"]);
  const {
    setCreateModalVisible, rightSidebarOpen, setRightSidebarOpen, setEditProfileModalVisible,
  } = useApp();
  // const {
  // 	did,
  // 	// loading,
  // } = useAppSelector(selectConnection);
  const path = usePathname();
  const isLanding = useMemo(() => {
    return path === "/";
  }, [path]);

  const profile = useAppSelector(selectProfile);
  const { status } = useContext(AuthContext); // Consume AuthContext

  const { connect, disconnect } = useContext(AuthContext);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      console.log(err);
    }
  };

  if (isLanding) {
    return (
      <Navbar
        logoSize="full"
        className="site-navbar">
        <NavbarMenu placement="right">
          {status !== AuthStatus.CONNECTED &&
            <Button
              theme="primary"
              onClick={handleConnect}
            >Connect Wallet</Button>
          }
        </NavbarMenu>
      </Navbar>
    );
  } else if (status !== AuthStatus.CONNECTED) {
    return (
      <Navbar
        logoSize="mini"
        className="site-navbar">
        <NavbarMenu placement="right">
          <Button theme="primary" onClick={handleConnect}>
            Connect Wallet
          </Button>
        </NavbarMenu>
      </Navbar>
    );
  }

  return (
    <Navbar className="site-navbar">
      <NavbarMenu>
        <div className={"navbar-sidebar-handlers mr-3"}>
          <Button onClick={() => setRightSidebarOpen(!rightSidebarOpen)} iconButton theme="clear">
            <IconHistory width={32} />
          </Button>
        </div>
        <Button style={{ height: "32px" }} className="pr-5 pl-5" onClick={() => { setCreateModalVisible(true); }} theme="primary">New Index</Button>
        <Dropdown
          dropdownClass="ml-3"
          position="bottom-right"
          menuItems={
            <>
              <DropdownMenuItem onClick={() => {
                setEditProfileModalVisible(true);
              }}>
                <Flex alignItems="center">
                  <IconSettings width={16} height="100%" />
                  <Text className="ml-3" element="span" size="md" >Profile Settings</Text>
                </Flex>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Flex alignItems="center">
                  <IconSettings width={12} height="100%" />
                  <Text className="ml-3" element="span" size="sm" theme="secondary">Settings</Text>
                </Flex>
              </DropdownMenuItem>
              <DropdownMenuItem divider />
              <DropdownMenuItem onClick={disconnect}>
                <Flex alignItems="center">
                  <IconDisconnect className="icon-error" width={16} height="100%" />
                  <Text className="ml-3 dropdown-text-logout" element="span" size="md" theme="error">Disconnect</Text>
                </Flex>
              </DropdownMenuItem>
            </>
          }>
          <Avatar size={32} user={profile} className="site-navbar__avatar" hoverable />
        </Dropdown>
      </NavbarMenu>
    </Navbar>
  )

};

export default AppHeader;


