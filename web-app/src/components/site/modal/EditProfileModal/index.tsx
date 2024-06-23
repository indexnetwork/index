import { useApi } from "@/context/APIContext";
import { updateProfile, uploadAvatar } from "@/store/api/did";
import {
  selectAvatar,
  selectDID,
  selectProfileLoading,
} from "@/store/slices/didSlice";
import { useAppDispatch, useAppSelector } from "@/store/store";
import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Header from "components/base/Header";
import IconEdit from "components/base/Icon/IconEdit";
import IconTrash from "components/base/Icon/IconTrash";
import Input from "components/base/Input";
import Modal, { ModalProps } from "components/base/Modal";
import Text from "components/base/Text";
import TextArea from "components/base/TextArea";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Row from "components/layout/base/Grid/Row";
import { appConfig } from "config";
import { useFormik } from "formik";
import { CID } from "multiformats";
import Image from "next/image";
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import ImageUploading from "react-images-uploading";

export interface EditProfileModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {}

const EditProfileModal = ({ ...modalProps }: EditProfileModalProps) => {
  const dispatch = useAppDispatch();
  const { api, ready: apiReady } = useApi();
  const did = useAppSelector(selectDID);
  const userProfile = did.data;
  const loading = useAppSelector(selectProfileLoading);
  const avatar = useAppSelector(selectAvatar);

  const handleClose = () => {
    modalProps.onClose?.();
  };

  const [image, setImage] = useState<CID | null>();

  useEffect(() => {
    setImage(did.avatar || userProfile?.avatar || null);
  }, [userProfile, did.avatar]);

  const formik = useFormik({
    initialValues: {
      name: userProfile.name || "",
      bio: userProfile.bio || "",
    },
    onSubmit: async (values) => {
      try {
        if (!apiReady || !api) return;

        const profileData = {
          name: values.name,
          bio: values.bio,
          avatar: avatar || userProfile.avatar,
        };

        await dispatch(updateProfile({ profile: profileData, api })).unwrap();
        toast.success("Profile updated successfully");
        handleClose();
      } catch (err) {
        console.error("Failed to update profile:", err);
        toast.error("Failed to update profile");
      }
    },
  });

  const onChange = useCallback(
    async (imageList: any) => {
      if (!apiReady || !api || imageList.length === 0) return;

      try {
        const imageFile = imageList[0].file;
        await dispatch(uploadAvatar({ api, file: imageFile })).unwrap();
        // toast.success("Image uploaded successfully");
      } catch (err) {
        console.error("Failed to upload image:", err);
        toast.error("Failed to upload image");
      }
    },
    [api, apiReady, dispatch],
  );

  return (
    <Modal
      {...modalProps}
      size={"xs"}
      body={
        <>
          <FlexRow rowSpacing={3} justify="center">
            <form
              style={{
                display: "contents",
              }}
              onSubmit={formik.handleSubmit}
            >
              {
                <Col xs={12}>
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

                          <div
                            className="img-upload mt-5"
                            onClick={onImageUpload}
                            {...dragProps}
                          >
                            {image ? (
                              <>
                                <div className="img-upload-img">
                                  <Image
                                    width="80"
                                    height="80"
                                    className="img-upload-img__img"
                                    src={`${appConfig.ipfsProxy}/${image.toString()}`}
                                    alt="Profile Image"
                                  />
                                </div>
                                <div
                                  className="img-upload-btns"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Avatar
                                    size={32}
                                    shape="square"
                                    hoverable
                                    onClick={() => onImageRemove(0)}
                                  >
                                    <IconTrash />
                                  </Avatar>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="img-upload__banner">
                                  <IconEdit />
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </ImageUploading>
                    </Col>
                  </FlexRow>
                </Col>
              }
              <Col xs={12}>
                <Row rowSpacing={3}>
                  <FlexRow>
                    <Col className="mt-6" xs={12}>
                      <Flex flexdirection="column">
                        <Text theme={"primary"} size="md">
                          Name
                        </Text>
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
                      <Flex flexdirection="column">
                        <Text theme={"primary"} size="md">
                          Bio
                        </Text>
                        <TextArea
                          rows={5}
                          name="bio"
                          inputSize={"lg"}
                          className="mt-3"
                          placeholder="Tell your story"
                          onChange={formik.handleChange}
                          value={formik.values.bio}
                        />
                      </Flex>
                    </Col>
                  </FlexRow>
                  <div className="modal-footer">
                    <Col pullLeft>
                      <Button
                        size="lg"
                        className="mt-7 pl-8 pr-8"
                        theme="clear"
                        onClick={handleClose}
                      >
                        Cancel
                      </Button>
                    </Col>
                    <Col auto pullRight>
                      <Button
                        theme="primary"
                        size="lg"
                        disabled={loading}
                        className="ml-auto mt-6 pl-8 pr-8"
                      >
                        Save
                      </Button>
                    </Col>
                  </div>
                </Row>
              </Col>
            </form>
          </FlexRow>
        </>
      }
      header={<Header level={2}>Edit Profile</Header>}
    />
  );
};

export default EditProfileModal;
