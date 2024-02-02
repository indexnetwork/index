// import PageLayout from "components/layout/site/PageLayout";
// import { serverSideTranslations } from "next-i18next/serverSideTranslations";
// import React, { ReactElement } from "react";
// import { NextPageWithLayout } from "types";
// import { useRouter } from "next/router";
// import Col from "components/layout/base/Grid/Col";
// import Flex from "components/layout/base/Grid/Flex";
// import Text from "components/base/Text";
// import Input from "components/base/Input";
// import FlexRow from "components/layout/base/Grid/FlexRow";
// import Button from "components/base/Button";
// import Header from "components/base/Header";
// import apiService from "services/api-service";

// const ZapierTestLoginPage: NextPageWithLayout = () => {
//   const router = useRouter();
//   async function create(e: any) {
//     e.preventDefault();
//     const testSession = await apiService.zapierTestLogin(
//       e.target[0].value,
//       e.target[1].value,
//     );
//     if (!testSession.success) return;
//     const sessionStr = Buffer.from(testSession.sessionData, "base64").toString(
//       "utf8",
//     );
//     const auth = JSON.parse(sessionStr);
//     const index = await apiService.getIndexById(auth.indexId);
//     if (!index) return;

//     localStorage.setItem("did", auth.session.personal);
//     localStorage.setItem(
//       `pkp_${index.pkpPublicKey}`,
//       JSON.stringify({
//         isCreator: true,
//         isPermittedAddress: true,
//         collabAction: index.collabAction,
//         session: auth.session.index,
//       }),
//     );
//     await router.push("/");
//   }

//   return (
//     <>
//       <FlexRow justify={"center"} className={"mt-10"}>
//         <form onSubmit={create}>
//           <Col>
//             <Header>Login with email</Header>
//             <Flex flexdirection="column" className={"mt-10"}>
//               <Text theme={"primary"} size="md">
//                 Email:
//               </Text>
//               <Input
//                 autoFocus={true}
//                 className="mt-3"
//                 inputSize={"lg"}
//                 name={"email"}
//                 placeholder="Your email"
//               />
//             </Flex>
//             <Flex flexdirection="column" className={"mt-5"}>
//               <Text theme={"primary"} size="md">
//                 Password:
//               </Text>
//               <Input
//                 type={"password"}
//                 autoFocus={true}
//                 className="mt-3"
//                 inputSize={"lg"}
//                 name={"password"}
//                 placeholder="Password"
//               />
//             </Flex>
//             <Flex>
//               <Col pullRight>
//                 <Button
//                   theme="primary"
//                   size="lg"
//                   type={"submit"}
//                   className="mt-7 pl-8 pr-8"
//                 >
//                   Login
//                 </Button>
//               </Col>
//             </Flex>
//           </Col>
//         </form>
//       </FlexRow>
//     </>
//   );
// };

// ZapierTestLoginPage.getLayout = function getLayout(page: ReactElement) {
//   return (
//     <PageLayout hasFooter={false} headerType="user">
//       {page}
//     </PageLayout>
//   );
// };

// export async function getServerSideProps({ locale }: any) {
//   return {
//     props: {
//       ...(await serverSideTranslations(locale, [
//         "common",
//         "pages",
//         "components",
//       ])),
//     },
//   };
// }

// export default ZapierTestLoginPage;
