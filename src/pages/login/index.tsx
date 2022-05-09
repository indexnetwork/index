import Button from "components/base/Button";
import IconLogout from "components/base/Icon/IconLogout";
import IconMetamask from "components/base/Icon/IconMetamask";
import MainPageContainer from "components/site/container/MainPageContainer";
import connectors from "connectors";
import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import PageLayout from "layout/site/PageLayout";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, {
	ReactElement,
	useEffect,
} from "react";
import { NextPageWithLayout } from "types";

import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";

const Login: NextPageWithLayout = () => {
	const { t } = useTranslation(["common", "components"]);

	const {
		account, activate, active, deactivate,
	} = useWeb3React<Web3Provider>();

	useEffect(() => {
		const provider = localStorage.getItem("provider");
		if (provider) {
			connect(provider as any);
		}
	}, []);

	// useEffect(() => {
	// 	if (account && active) {
	// 		Router.push("/");
	// 	}
	// }, [active, account]);

	const connect = async (provider: keyof typeof connectors) => {
		try {
			await activate(connectors[provider]);
			localStorage.setItem("provider", provider);
		} catch (err) {
			console.log(err);
		}
	};

	const disconnect = () => {
		resetProvider();
		deactivate();
	};

	const resetProvider = () => {
		localStorage.removeItem("provider");
	};

	return (
		<MainPageContainer>
			<FlexRow
				rowSpacing={3}
				justify="center"
				className="idx-mb-lg-6"
			>
				{
					account && active ? (
						<Col>
							<Button
								theme="clear"
								addOnAfter
								onClick={disconnect}>
								Logout
								<IconLogout />
							</Button>
						</Col>
					) : (
						<Col>
							<Button
								theme="clear"
								addOnAfter
								onClick={() => connect("injected")}>
								{t("components:loginForm.googleBtn")}
								<IconMetamask />
							</Button>
						</Col>
					)
				}
			</FlexRow>
		</MainPageContainer>

	);
};

Login.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

export async function getStaticProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "components"])),
		},
	};
}

export default Login;
