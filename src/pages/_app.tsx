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
	children: React.ReactNode;
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
							<link rel="shortcut icon" href="/favicon-white.png" />
							<title>index.as | The human bridge between context and content.</title>
							<meta name="title" content="index.as | The human bridge between context and content." />
							<meta name="description" content="Create and monetize discovery engines." />

							<meta property="twitter:card" content="summary_large_image" />
							<meta property="twitter:url" content="https://index.as" />
							<meta property="twitter:title" content="index.as | The human bridge between context and content." />
							<meta property="twitter:description" content="Create and monetize discovery engines." />
							<meta property="twitter:image" content="https://testnet.index.as/images/bridge.jpg" />

							<link rel="preload" as="font" href="/fonts/Freizeit-Regular.woff2" type="font/woff2" crossOrigin="anonymous" />
							<link rel="preload" as="font" href="/fonts/Freizeit-Bold.woff2" type="font/woff2" crossOrigin="anonymous" />
							<link rel="preload" as="font" href="/fonts/Roquefort-Standart.woff2" type="font/woff2" crossOrigin="anonymous" />
							<link rel="preload" as="font" href="/fonts/Inter-Bold.woff2" type="font/woff2" crossOrigin="anonymous" />
							<link rel="preload" as="font" href="/fonts/Inter-Regular.woff2" type="font/woff2" crossOrigin="anonymous" />
							<link href="/fonts/fonts.css" rel="stylesheet" />
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
