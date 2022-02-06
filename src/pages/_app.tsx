import type { AppProps } from "next/app";
import { NextPageWithLayout } from "types";
// import "../../.semantic/dist/semantic.min.css";
import "../styles/main.scss";
import { appWithTranslation } from "next-i18next";

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
	const getLayout = Component.getLayout ?? ((page) => page);

	return getLayout(<Component {...pageProps} />);
}

export default appWithTranslation(MyApp as any);
