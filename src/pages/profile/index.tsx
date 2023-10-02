import React, { ReactElement, useEffect, useState } from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import { useTranslation } from "next-i18next";
import PageLayout from "components/layout/site/PageLayout";
import { useCeramic } from "hooks/useCeramic";
import { useAppDispatch, useAppSelector } from "hooks/store";
import Header from "components/base/Header";
import Row from "components/layout/base/Grid/Row";
import Flex from "components/layout/base/Grid/Flex";
import Text from "components/base/Text";
import Input from "components/base/Input";
import { selectProfile, setProfile } from "store/slices/profileSlice";
import { useFormik } from "formik";
import Button from "components/base/Button";
import TextArea from "components/base/TextArea";
import ImageUploading from "react-images-uploading";
import Avatar from "components/base/Avatar";
import IconTrash from "components/base/Icon/IconTrash";
import { appConfig } from "config";
import IconEdit from "components/base/Icon/IconEdit";
import { Users } from "types/entity";
import { CID } from "multiformats";
import apiService from "services/api-service";

const ProfileSettingsPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

	const [loading, setLoading] = useState(false);
	const personalCeramic = useCeramic();
	const profile = useAppSelector(selectProfile);
	const [image, setImage] = useState<CID>();

	const dispatch = useAppDispatch();

	const formik = useFormik<Users>({
		initialValues: {
			...profile,
		},
		onSubmit: async (values) => {
			try {
				setLoading(true);
				if (image) {
					values.avatar = image;
				} else {
					delete values.avatar;
				}
				const { available, ...rest } = values;
				await personalCeramic.setProfile(rest);
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

	const onChange = async (imageList: any) => {
		if (imageList.length > 0) {
			const res = await apiService.uploadAvatar(imageList[0].file);
			res && setImage(res.cid);
		} else {
			setImage(undefined);
		}
	};

	useEffect(() => {
		profile.avatar && setImage(profile.avatar);
	}, [profile]);

	return (
		<>
			<Container className="profile-page my-6 my-lg-8">
				<FlexRow rowSpacing={3} justify="center">
					<Col xs={12} lg={9} className="mb-7">
						<Header>Edit your profile</Header>
					</Col>
					<form style={{
						display: "contents",
					}} onSubmit={formik.handleSubmit}>
						{
							(
								<Col xs={12} lg={9}>
									<FlexRow>
										<Col>
											<Text>Profile Image</Text>
											<ImageUploading
												value={image ? [image] : []}
												onChange={onChange}
												dataURLKey="cid"
											>
												{({
													  imageList,
													  onImageUpload,
													  onImageRemoveAll,
													  onImageUpdate,
													  onImageRemove,
													  isDragging,
													  dragProps,
												  }) => (
													// write your building UI

													<div className="mt-5 img-upload"
														 onClick={onImageUpload}
														 {...dragProps}>
														{
															image ?
																<>
																	<div className="img-upload-img">
																		<img className="img-upload-img__img" src={`${appConfig.ipfsProxy}/${image.toString()}`} alt="profile_img"/>
																	</div>
																	<div
																		className="img-upload-btns"
																		onClick={(e) => e.stopPropagation()}
																	>
																		<Avatar size={32}
																			shape="square"
																			hoverable
																			onClick={() => onImageRemove(0)}>
																			<IconTrash/>
																		</Avatar>
																	</div>
																</> : <>
																	<div className="img-upload__banner">
																		<IconEdit/>
																	</div>
																</>
														}
													</div>
												)}
											</ImageUploading>
										</Col>
									</FlexRow>
								</Col>
							)
						}
						<Col xs={12} lg={9} >
							<Row rowSpacing={3}>
								<FlexRow>
									<Col className="mt-6" xs={12} sm={6}>
										<Flex flexDirection="column">
											<Text theme={"primary"} size="md">Name</Text>
											<Input
												inputSize={"lg"}
												placeholder="Enter your name"
												name="name"
												className="mt-3"
												onChange={formik.handleChange}
												value={formik.values.name}
											/>
										</Flex>
									</Col>
								</FlexRow>
								<FlexRow>
									<Col className="mt-6" xs={12} sm={6}>
										<Flex flexDirection="column">
											<Text theme={"primary"} size="md">Bio</Text>
											<TextArea
												rows={5}
												name="bio"
												inputSize={"lg"}
												placeholder="Tell your story..."
												onChange={formik.handleChange}
												value={formik.values.bio}
											/>
										</Flex>
									</Col>
								</FlexRow>
								<Col auto pullLeft>
									<Button theme="primary" size="lg" disabled={loading} className="ml-auto mt-6 pl-8 pr-8">Save</Button>
								</Col>
							</Row>
						</Col>
					</form>
				</FlexRow>
			</Container>
		</>
	);
};

ProfileSettingsPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

ProfileSettingsPage.requireAuth = true;

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "profile", "components"])),
		},
	};
}
export default ProfileSettingsPage;
