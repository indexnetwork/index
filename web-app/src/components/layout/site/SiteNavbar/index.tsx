// import Avatar from "components/base/Avatar";
// import Button from "components/base/Button";
// import Text from "components/base/Text";
// import Dropdown from "components/base/Dropdown";
// import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";

// import Flex from "components/layout/base/Grid/Flex";
// import { useTranslation } from "next-i18next";
// import React, { useCallback, useContext } from "react";
// import IconDisconnect from "components/base/Icon/IconDisconnect";
// import { AuthContext, AuthStatus, useAuth } from "@/context/AuthContext";
// import { useAppSelector } from "hooks/store";

// import IconSettings from "components/base/Icon/IconSettings";
// import Navbar, { NavbarProps, NavbarMenu } from "components/layout/base/Navbar";
// import { useRouter } from "next/router";
// import IconHistory from "components/base/Icon/IconHistory";
// import { useApp } from "@/context/AppContext";

// export interface LandingHeaderProps extends NavbarProps {
//   headerType: "public" | "user";
//   isLanding?: boolean;
// }

// const SiteNavbar = ({
//   headerType = "user",
//   isLanding = false,
//   ...baseProps
// }: LandingHeaderProps) => {
//   const { t } = useTranslation(["common", "components"]);

//   const {
//     setCreateModalVisible,
//     rightSidebarOpen,
//     setRightSidebarOpen,
//     setEditProfileModalVisible,
//   } = useApp();
//   // const {
//   // 	did,
//   // 	// loading,
//   // } = useAppSelector(selectConnection);

//   const { status } = useContext(AuthContext); // Consume AuthContext

//   const authenticated = useAuth();
//   const { connect, disconnect } = useContext(AuthContext);
//   const handleConnect = async () => {
//     try {
//       // await connect();
//     } catch (err) {
//       console.log(err);
//     }
//   };

//   const renderHeader = useCallback(
//     () =>
//       headerType === "public" ? (
//         <Navbar
//           className="site-navbar"
//           logoSize="full"
//           sticky
//           bgColor={isLanding ? "#fff" : undefined}
//           bordered={false}
//           isLanding
//           {...baseProps}
//         >
//           <NavbarMenu placement="right">
//             {status === AuthStatus.LOADING && isLanding ? (
//               <Button theme="primary" className="lottie-text" loading={true}>
//                 {"Connecting"}
//               </Button>
//             ) : (
//               <Button theme="primary" onClick={handleConnect}>
//                 {t("common:connect")}
//               </Button>
//             )}
//           </NavbarMenu>
//         </Navbar>
//       ) : (
//         <Navbar className="site-navbar" logoSize="mini" {...baseProps}>
//           {AuthStatus.CONNECTED ? (
//             <NavbarMenu>
//               <div className={"navbar-sidebar-handlers mr-3"}>
//                 {" "}
//                 <Button
//                   onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
//                   iconButton
//                   theme="clear"
//                 >
//                   <IconHistory width={32} />
//                 </Button>
//               </div>
//               <Button
//                 style={{ height: "32px" }}
//                 className="pl-5 pr-5"
//                 onClick={() => {
//                   setCreateModalVisible(true);
//                 }}
//                 theme="primary"
//               >
//                 {t("components:header.newIndexBtn")}
//               </Button>
//               <Dropdown
//                 dropdownClass="ml-3"
//                 position="bottom-right"
//                 menuItems={
//                   <>
//                     <DropdownMenuItem
//                       onClick={() => {
//                         setEditProfileModalVisible(true);
//                       }}
//                     >
//                       <Flex alignitems="center">
//                         <IconSettings width={16} height="100%" />
//                         <Text className="ml-3" element="span" size="md">
//                           Profile Settings
//                         </Text>
//                       </Flex>
//                     </DropdownMenuItem>
//                     {/* <DropdownMenuItem>
// 									<Flex alignitems="center">
// 										<IconSettings width={12} height="100%" />
// 										<Text className="ml-3" element="span" size="sm" theme="secondary">{t("common:settings")}</Text>
// 									</Flex>
// 								</DropdownMenuItem> */}
//                     <DropdownMenuItem divider />
//                     <DropdownMenuItem onClick={disconnect}>
//                       <Flex alignitems="center">
//                         <IconDisconnect
//                           className="icon-error"
//                           width={16}
//                           height="100%"
//                         />
//                         <Text
//                           className="dropdown-text-logout ml-3"
//                           element="span"
//                           size="md"
//                           theme="error"
//                         >
//                           {t("common:disconnect")}
//                         </Text>
//                       </Flex>
//                     </DropdownMenuItem>
//                   </>
//                 }
//               >
//                 <Avatar
//                   size={32}
//                   user={profile}
//                   className="site-navbar__avatar"
//                   hoverable
//                 />
//               </Dropdown>
//             </NavbarMenu>
//           ) : (
//             <NavbarMenu placement="right">
//               <Button theme="primary" onClick={handleConnect}>
//                 {t("common:connect")}
//               </Button>
//             </NavbarMenu>
//           )}
//         </Navbar>
//       ),
//     [headerType, baseProps, isLanding, t],
//   );

//   return renderHeader();
// };

// export default SiteNavbar;
