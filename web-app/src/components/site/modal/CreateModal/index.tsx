import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Input from "components/base/Input";
import Button from "components/base/Button";
import { useTranslation } from "next-i18next";
import FlexRow from "components/layout/base/Grid/FlexRow";

export interface CreateModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  onCreate: (title: string) => void;
}

const CreateModal = ({ onCreate, ...modalProps }: CreateModalProps) => {
  const { t } = useTranslation(["pages"]);

  const handleClose = () => {
    modalProps.onClose?.();
  };
  const handleEnter = (e: any) => {
    if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
      onCreate?.(title);
    }
  };

  const [title, setTitle] = useState<string>("");

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({
    target,
  }) => {
    const { value } = target;
    setTitle(value);
  };

  return (
    <Modal
      {...modalProps}
      size={"xs"}
      body={
        <>
          <FlexRow>
            <Col xs={12}>
              <Flex flexdirection="column">
                <Text theme={"primary"} size="md">
                  Title:
                </Text>
                <Input
                  autoFocus={true}
                  value={title || ""}
                  onKeyDown={handleEnter}
                  onChange={handleChange}
                  // loading={loading}
                  className="mt-3"
                  inputSize={"lg"}
                  placeholder="e.g. Web3 Social Ecosystem"
                />
              </Flex>
            </Col>
          </FlexRow>
        </>
      }
      header={<Header level={2}>Create New Index</Header>}
      footer={
        <>
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
          <Col pullRight>
            <Button
              disabled={!title}
              onClick={() => onCreate(title)}
              theme="primary"
              size="lg"
              className="mt-7 pl-8 pr-8"
            >
              Create
            </Button>
          </Col>
        </>
      }
    />
  );
};

export default CreateModal;
