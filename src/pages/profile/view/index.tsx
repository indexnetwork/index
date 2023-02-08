import React, { ReactElement, useState } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import { useCeramic } from "hooks/useCeramic";
import { useRouter } from "next/router";
import { useAppDispatch, useAppSelector } from "hooks/store";
import { selectConnection } from "store/slices/connectionSlice";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Text from "components/base/Text";
import { selectProfile, setProfile } from "store/slices/profileSlice";
import { useFormik } from "formik";
import Button from "components/base/Button";
import { ImageType } from "react-images-uploading";
import Avatar from "components/base/Avatar";
import { appConfig } from "config";
import TabPane from "components/base/Tabs/TabPane";
import { Tabs } from "components/base/Tabs";
import IconEditBlack from "components/base/Icon/IconEditBlack";
import { Users } from "../../types/entity";

const CreateIndexPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);
	const [tabKey, setTabKey] = useState("myindexes");
	const [loading, setLoading] = useState(false);

	const profile = useAppSelector(selectProfile);

	const dispatch = useAppDispatch();

	const formik = useFormik<Users>({
		initialValues: {
			...profile,
		},
		onSubmit: async (values) => {
			try {
				setLoading(true);
				const result = await handleUploadImage();
				if (result) {
					values.pfp = `ipfs://${result.path}`;
				}
				const { available, ...rest } = values;
				await ceramic.setProfile(rest);
				dispatch(setProfile({
					...rest,
					available: true,
				}));
			} catch (err) {
				console.log(err);
			} finally {
				setLoading(false);
			}
		},
	});

	const router = useRouter();

	const ceramic = useCeramic();

	const { did } = useAppSelector(selectConnection);

	const [images, setImages] = useState<ImageType[]>([]);

	const {
		available,
		name,
		pfp,
	} = useAppSelector(selectProfile);

	return (
		<>
			<Container
				className="profile-page my-6 my-lg-8"
			>
				<FlexRow
					rowSpacing={1}
					justify="center"
				>
					<Col
						xs={12}
						lg={9}
					>
						<Col pullRight>
							<Button onClick={() => {
								router.push("/profile");
							}} theme="clear"><IconEditBlack /><Text className="ml-2"> Edit Profile</Text></Button>
						</Col>
						<Col>
							<Flex>
								<Avatar className="site-navbar__avatar mr-8" hoverable size={80} randomColor>{
									pfp ?
										<img src={pfp.replace("ipfs://", appConfig.ipfsProxy)} alt="profile_img"/> : (
											available && name ? name : "Y"
										)}
								</Avatar>
								<Col className="mb-6">
									<Header className="mb-3" >{name}</Header>
									<Text>lorem ipsum</Text>
									<Col className="mt-4"></Col>
									<Text>lorem ipsum</Text>
								</Col>
							</Flex>
						</Col>
						<Tabs activeKey={tabKey} onTabChange={setTabKey}>
							<TabPane enabled={true} tabKey={"myindexes"} title={"My indexes"} />
							<TabPane enabled={true} tabKey={"starred"} title={"Starred"} />
							<TabPane enabled={true} tabKey={"discovered"} title={"Discovered"} />
						</Tabs>
					</Col>
				</FlexRow>
			</Container>
		</>
	);
};

CreateIndexPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

CreateIndexPage.requireAuth = true;

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "profile", "components"])),
		},
	};
}
export default CreateIndexPage;
