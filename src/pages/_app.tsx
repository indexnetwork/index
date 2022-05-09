import type { AppProps } from "next/app";
// import "../../.semantic/dist/semantic.min.css";
import "../styles/main.scss";

import { appWithTranslation } from "next-i18next";
import Head from "next/head";
import { NextPageWithLayout } from "types";

import { Web3Provider } from "@ethersproject/providers";
import { Web3ReactProvider } from "@web3-react/core";

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page) => page);

	function getLibrary(provider: any) {
		return new Web3Provider(provider);
	}

	return (
		<Web3ReactProvider getLibrary={getLibrary}>
			<Head>
				<title>Index.as</title>
				<link rel="stylesheet preload prefetch" as="style" href="/fonts/fonts.css" type="text/css" />
				<meta name="title" content="Index.as" />
				<meta
					name="description"
					content="Share curated links about any topic as a searchable index."
				></meta>
			</Head>
			{getLayout(<Component {...pageProps} />)}
		</Web3ReactProvider>
	);
}

export default appWithTranslation(MyApp as any);
