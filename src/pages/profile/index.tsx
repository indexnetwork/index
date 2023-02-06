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
import Divider from "components/base/Divider";
import Row from "components/layout/base/Grid/Row";
import Flex from "components/layout/base/Grid/Flex";
import Text from "components/base/Text";
import Input from "components/base/Input";
import { selectProfile, setProfile } from "store/slices/profileSlice";
import { useFormik } from "formik";
import Button from "components/base/Button";
import TextArea from "components/base/TextArea";
import Spin from "components/base/Spin";
import IconLock from "components/base/Icon/IconLock";
import ImageUploading, { ImageType } from "react-images-uploading";
import Avatar from "components/base/Avatar";
import IconTrash from "components/base/Icon/IconTrash";
import { appConfig } from "config";
import { Users } from "../../types/entity";

const CreateIndexPage: NextPageWithLayout = () => {
	const { t } = useTranslation(["pages"]);

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

	const onChange = (imageList: any, addUpdateIndex: any) => {
		// data for submit
		console.log(imageList, addUpdateIndex);
		setImages(imageList);
	};

	const handleUploadImage = async () => {
		if (images && images.length > 0) {
			const imgFile = images[0].file;
			return ceramic.uploadImage(imgFile!);
		}
	};

	return (
		<>
			<Container
				className="profile-page my-6 my-lg-8"
			>
				<FlexRow
					rowSpacing={3}
					justify="center"
				>
					<Col
						xs={12}
						lg={9}
					>
						<Header>Edit your profile</Header>
						<Divider />
					</Col>
					<form style={{
						display: "contents",
					}} onSubmit={formik.handleSubmit}>
						{
							true && (
								<Col
									xs={12}
									lg={9}
									style={{
										display: "flex",
										justifyContent: "center",
									}}
									className="my-3"
								>
									<ImageUploading
										value={images}
										onChange={onChange}
										dataURLKey="data_url"
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
											<div className="img-upload"
												onClick={onImageUpload}
												{...dragProps}>
												{
													// eslint-disable-next-line no-nested-ternary
													imageList.length === 0 && !profile.image ?
														<div className="img-upload__banner"><Text fontWeight={600}
															theme="white">Click or Drop Image</Text></div> : (
															imageList.length !== 0 ? (
																imageList.map((image, index) => (
																	<>
																		<div key={index} className="img-upload-img">
																			<img className="img-upload-img__img" src={image.data_url} alt="" />
																		</div>
																		<div className="img-upload-btns" onClick={(e) => e.stopPropagation()}>
																			{/* <Avatar size={32}
																				hoverable onClick={() => onImageUpdate(index)}><IconAdd /></Avatar> */}
																			<Avatar
																				size={32}
																				hoverable onClick={() => onImageRemove(index)}><IconTrash /></Avatar>
																		</div>
																	</>
																))
															) : (
																<>
																	<div className="img-upload-img">
																		<img className="img-upload-img__img"
																			src={profile!.image!.alternatives![0].src.replace("ipfs://", appConfig.ipfsProxy)} alt="" />
																	</div>
																	<div className="img-upload-btns" onClick={(e) => e.stopPropagation()}>
																		{/* <Avatar size={32}
																			hoverable onClick={() => onImageUpdate(0)}><IconAdd /></Avatar> */}
																		<Avatar
																			size={32}
																			hoverable onClick={() => onImageRemove(0)}><IconTrash /></Avatar>
																	</div>
																</>
															)
														)
												}
											</div>
										)}
									</ImageUploading>
								</Col>
							)
						}
						<Col
							xs={12}
							lg={9}
						>
							<Row
								rowSpacing={3}
							>
								<Col xs={12} sm={6}><Text fontWeight={700}>Enter your personal details</Text></Col>
								<Col xs={12} sm={6}><Flex flexDirection="column">
									<Text fontWeight={500}>Name</Text>
									<Input
										name="name"
										className="mt-3"
										onChange={formik.handleChange}
										value={formik.values.name}
									/>
								</Flex></Col>
								<Col xs={12} sm={6}><Text fontWeight={700}>Add a Short Bio</Text></Col>
								<Col xs={12} sm={6}>
									<Flex flexDirection="column">
										<Text fontWeight={500}>Bio</Text>
										<TextArea
											name="description"
											className="mt-3"
											onChange={formik.handleChange}
											value={formik.values.description}
										/>
									</Flex>
								</Col>
								<Col
									auto
									pullRight
								>
									<Button
										disabled={loading}
										className="ml-auto"
										addOnAfter={loading ?
											<Spin size="xs" className="ml-4" active={true} thickness="light" theme="white" /> :
											<IconLock width={"1.6rem"} stroke="white" />} type="submit">Save</Button>
								</Col>
							</Row>
						</Col>

					</form>
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
