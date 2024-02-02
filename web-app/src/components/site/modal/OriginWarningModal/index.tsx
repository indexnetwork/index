import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Button from "components/base/Button";
import Link from "next/link";

import { useAppDispatch } from "hooks/store";
import { setOriginNFTModalVisible } from "store/slices/connectionSlice";

export interface OriginWarningModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  visible: boolean;
}

const OriginWarningModal = ({ ...modalProps }: OriginWarningModalProps) => {
  const dispatch = useAppDispatch();

  const handleClose = () => {
    dispatch(setOriginNFTModalVisible(false));
  };
  return (
    <Modal
      {...modalProps}
      onClose={handleClose}
      size={"xs"}
      body={
        <>
          <Row>
            <Col xs={12}>
              <Flex alignitems="center">
                <Flex
                  flexdirection="column"
                  flexWrap="wrap"
                  flexGrow={1}
                  className="ml-3"
                >
                  <Text size="lg">
                    To access the beta version, please fill out a short form.
                    <br />
                    Once done, we will send you an NFT for access.
                    <br />
                  </Text>
                </Flex>
              </Flex>

              <Col pullLeft>
                <Button
                  className="ml-3 mt-7 pl-8 pr-8"
                  size="lg"
                  theme="clear"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
              </Col>
              <Col pullRight>
                <Link
                  href={
                    "https://docs.google.com/forms/d/1XkV-Fu4OqTDF42UiGHT7NdveTgia6QoBFscXNKzwb1U/edit"
                  }
                  target={"_blank"}
                >
                  <Button
                    theme="primary"
                    size="lg"
                    className="mr-2 mt-7 pl-8 pr-8"
                  >
                    Apply for beta
                  </Button>
                </Link>
              </Col>
            </Col>
          </Row>
        </>
      }
      header={<Header level={2}>We should meet!</Header>}
    />
  );
};

export default OriginWarningModal;
