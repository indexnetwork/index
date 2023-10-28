import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import React, { useEffect, useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Input from "components/base/Input";
import Button from "components/base/Button";
import { useTranslation } from "next-i18next";
import FlexRow from "components/layout/base/Grid/FlexRow";
import ImageUploading from "react-images-uploading";
import { appConfig } from "config";
import Avatar from "components/base/Avatar";
import IconTrash from "components/base/Icon/IconTrash";
import IconEdit from "components/base/Icon/IconEdit";
import Row from "components/layout/base/Grid/Row";
import TextArea from "components/base/TextArea";
import { useCeramic } from "hooks/useCeramic";
import { useAppDispatch, useAppSelector } from "hooks/store";
import { selectProfile, setProfile } from "store/slices/profileSlice";
import { CID } from "multiformats";
import { useFormik } from "formik";
import { Users } from "types/entity";
import apiService from "services/api-service";

export interface EditProfileModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
}

const EditProfileModal = ({
	...modalProps
} : EditProfileModalProps) => {
	const handleClose = () => {
		modalProps.onClose?.();
	};

	const { t } = useTranslation(["pages"]);

	const [loading, setLoading] = useState(false);
	const personalCeramic = useCeramic();
	const profile = useAppSelector(selectProfile);
	const [image, setImage] = useState<CID>();
	const dispatch = useAppDispatch();

	const formik = useFormik<Partial<Users>>({
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
				const newProfile = await personalCeramic.setProfile(rest as Users);
				dispatch(setProfile({
					...newProfile,
					available: true,
				}));
			} catch (err) {
				console.log(err);
			} finally {
				setLoading(false);
				handleClose();
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

	return <Modal {...modalProps} size={"xs"} body={(
		<>
			<FlexRow rowSpacing={3} justify="center">

				<form style={{
					display: "contents",
				}} onSubmit={formik.handleSubmit}>
					{
						(
							<Col xs={12} >
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
					<Col xs={12}>
						<Row rowSpacing={3}>
							<FlexRow>
								<Col className="mt-6" xs={12} >
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
								<Col className="mt-6" xs={12}>
									<Flex flexDirection="column">
										<Text theme={"primary"} size="md">Bio</Text>
										<TextArea
											rows={5}
											name="bio"
											inputSize={"lg"}
											placeholder="Tell your story"
											onChange={formik.handleChange}
											value={formik.values.bio}
										/>
									</Flex>
								</Col>
							</FlexRow>
							<div className="modal-footer">
								<Col auto pullLeft>
									<Button theme="primary" size="lg" disabled={loading} className="ml-auto mt-6 pl-8 pr-8">Save</Button>
								</Col>
							</div>

						</Row>
					</Col>
				</form>
			</FlexRow>
		</>
	)}
	header={<Header level={2}>Edit Profile</Header>}
	/>;
};

export default EditProfileModal;
