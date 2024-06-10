import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
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
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import ImageUploading from "react-images-uploading";
import { Indexes, Users } from "types/entity";
import Image from "next/image";

export interface EditProfileModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {}

const EditProfileModal = ({ ...modalProps }: EditProfileModalProps) => {
  const { userProfile, setUserProfile, indexes, setIndexes } = useApp();
  const { api, ready: apiReady } = useApi();
  const handleClose = () => {
    modalProps.onClose?.();
  };

  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<CID>();

  const updateIndexesOwnerProfile = useCallback((profile: Users) => {
    const updatedIndexes = indexes.map((index: Indexes) => {
      if (index.controllerDID.id === profile.id) {
        return {
          ...index,
          controllerDID: profile,
        };
      }
      return index;
    });
    setIndexes(updatedIndexes);
  }, []);

  const formik = useFormik<Partial<Users>>({
    initialValues: {
      ...userProfile,
    },
    onSubmit: async (values) => {
      try {
        if (!apiReady) return;
        setLoading(true);
        const params: Partial<Users> = {
          name: values.name,
          bio: values.bio,
        };
        if (image) {
          params.avatar = image;
        }
        const newProfile = await api!.updateProfile(params);
        setUserProfile(newProfile);
        updateIndexesOwnerProfile(newProfile);
        toast.success("Profile updated successfully");
      } catch (err) {
        console.log(err);
        toast.error("Failed to update profile, please try again");
      } finally {
        setLoading(false);
        handleClose();
      }
    },
  });

  const onChange = useCallback(
    async (imageList: any) => {
      if (!apiReady) return;
      if (imageList.length > 0) {
        try {
          const res = await api!.uploadAvatar(imageList[0].file);
          res && setImage(res.cid);
          toast.success("Image uploaded successfully");
        } catch (err: any) {
          console.error(err);
          let message = "";
          if (err.response.status === 413) {
            message = "Image size is too large";
          }
          toast.error(`Failed to upload image: ${message}`);
        }
      } else {
        setImage(undefined);
      }
    },
    [api, apiReady],
  );

  useEffect(() => {
    if (!userProfile) return;

    userProfile.avatar && setImage(userProfile.avatar);
    updateIndexesOwnerProfile(userProfile);
  }, [userProfile, updateIndexesOwnerProfile]);

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
                    <Col auto pullLeft>
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
