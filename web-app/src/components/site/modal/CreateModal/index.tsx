import Button from "components/base/Button";
import Header from "components/base/Header";
import Input from "components/base/Input";
import Modal, { ModalProps } from "components/base/Modal";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useState } from "react";

export interface CreateModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  onCreate: (title: string) => void;
  cancelVisible?: boolean;
}

const CreateModal = ({
  onCreate,
  cancelVisible = true,
  ...modalProps
}: CreateModalProps) => {
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
          {cancelVisible && (
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
          )}
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
