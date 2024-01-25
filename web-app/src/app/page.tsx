'use client';

export const dynamic = 'force-dynamic';

import Flex from "components/layout/base/Grid/Flex";
import AppHeader from "components/layout/site/AppHeader";
import { APIProvider } from "components/site/context/APIContext";
import { AuthProvider } from "components/site/context/AuthContext";
import LandingSection1 from "components/site/landing/LandingSection1";
import LandingSection1v2 from "components/site/landing/LandingSection1v2";
import LandingSection2 from "components/site/landing/LandingSection2";
import LandingSection3 from "components/site/landing/LandingSection3";
import LandingSection4 from "components/site/landing/LandingSection4";
import LandingSection5 from "components/site/landing/LandingSection5";
import LandingSection7 from "components/site/landing/LandingSection7";
import { AppContextProvider } from "hooks/useApp";
import PlausibleProvider from "next-plausible";
import Head from "next/head";
import { Component } from "react";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Provider } from "react-redux";
import { store } from "store";
import { NextPageWithLayout } from "types";

const Landing: NextPageWithLayout = () => {
  const { t } = useTranslation(["pages"]);
  // return (
  //   <Flex
  //     flexDirection="column"
  //   >
  //     <LandingSection1 />
  //   </Flex>
  // );
  return (
    <Flex
			flexDirection="column"
		>
      <AppHeader />
			<LandingSection1 />
			<LandingSection1v2 />
			<LandingSection2 />
			<LandingSection3 />
			<LandingSection4 />
			<LandingSection5 />
			<LandingSection7 />
		</Flex> 
  );
};

export default Landing;


{/* <Flex
			flexDirection="column"
		>
			<LandingSection1 />
			<LandingSection1v2 />
			<LandingSection2 />
			<LandingSection3 />
			<LandingSection4 />
			<LandingSection5 />
			<LandingSection7 />
		</Flex> */}