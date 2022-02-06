import React, { ReactElement } from "react";
import LandingLayout from "layout/site/LandingLayout";
import { NextPageWithLayout } from "types";
import SignInForm from "components/site/forms/SignInForm";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import Button from "components/base/Button";
import Link from "next/link";
import Flex from "layout/base/Flex";

const Login: NextPageWithLayout = () => {
	const { t } = useTranslation(["common", "components"]);
	return (
		<div >
			<div style={{
				maxWidth: 340,
			}}>
				<div
					style={{
						marginTop: 65,
					}}
				>
					<div>
						<Flex flexDirection="column">
							<div style={{ marginBottom: 0 }}>{t("common:signIn")}</div>
							<span>{t("components:loginForm.subtitle")} <Link href="/register">{t("components:loginForm:create")}</Link></span>
						</Flex>
					</div>
					<div >
						<Button customType="google">{t("components:loginForm.googleBtn")}</Button>
					</div>
					<div >
						<Button customType="twitter">{t("components:loginForm.twitterBtn")}</Button>
					</div>
					<div >
						{t("components:loginForm.signIn")}
					</div>
					<div >
						<SignInForm />
					</div>
				</div>
			</div>
		</div>
	);
};

Login.getLayout = function getLayout(page: ReactElement) {
	return (
		<LandingLayout>
			{page}
		</LandingLayout>
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
