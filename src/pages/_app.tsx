import "../styles/main.scss";
import type { AppProps } from "next/app";
import CeramicProvider from "components/site/context/CeramicProvider";
import { appWithTranslation } from "next-i18next";
import Head from "next/head";
import { NextPageWithLayout } from "types";

import { Web3Provider } from "@ethersproject/providers";
import { Web3ReactProvider } from "@web3-react/core";
import AuthGuard from "components/site/guard/AuthGuard";
import { Provider } from "react-redux";
import { store } from "store";
import { AuthHandlerProvider } from "components/site/context/AuthHandlerProvider";

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page: any) => page);

	function getLibrary(provider: any) {
		return new Web3Provider(provider);
	}

	return (
		<Web3ReactProvider getLibrary={getLibrary}>
			<Provider store={store}>
				<AuthHandlerProvider>
					<CeramicProvider>
						<Head>
							<title>Index.as</title>
							<meta name="title" content="Index.as" />
							<link rel="shortcut icon" href="/favicon-white.png" />
							<meta
								name="description"
								content="Share curated links about any topic as a searchable index."
							></meta>
							<link rel="preload" as="font" href="/fonts/Freizeit-Regular.woff2" crossOrigin="" type="font/woff2"/>
							<link rel="preload" as="font" href="/fonts/Freizeit-Bold.woff2" crossOrigin="" type="font/woff2"/>
							<link rel="preload" as="font" href="/fonts/Roquefort-Standart.woff2" crossOrigin="" type="font/woff2"/>
							<link rel="preload" as="font" href="/fonts/Inter-Bold.woff2" crossOrigin="" type="font/woff2"/>
							<link rel="preload" as="font" href="/fonts/Inter-Regular.woff2" crossOrigin="" type="font/woff2"/>
						</Head>
						{Component.requireAuth ? (
							<AuthGuard>
								{getLayout(<Component {...pageProps} />)}
							</AuthGuard>
						) : (
							getLayout(<Component {...pageProps} />)
						)}
					</CeramicProvider>
				</AuthHandlerProvider>
			</Provider>
		</Web3ReactProvider>
	);
}

export default appWithTranslation(MyApp as any);
