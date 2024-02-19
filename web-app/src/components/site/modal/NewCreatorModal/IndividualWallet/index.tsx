import React, { useCallback, useState } from "react";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Input from "components/base/Input";
import Select from "components/base/Select";
import Option from "components/base/Select/Option";
import Button from "components/base/Button";
import Row from "components/layout/base/Grid/Row";
import { AccessControlCondition } from "types/entity";
import { appConfig } from "config";
import { useFormik } from "formik";
import { isValidContractAddress } from "utils/helper";
import { useApi } from "@/context/APIContext";

export interface IndividualWalletOptionsProps {
  handleBack(): void;
  handleCreate(condition: AccessControlCondition): void;
}

const IndividualWallet: React.FC<IndividualWalletOptionsProps> = ({
  handleBack,
  handleCreate,
}) => {
  const [address, setAddress] = useState("");
  const { api, ready: apiReady } = useApi();

  const validate = useCallback(
    async (values: any) => {
      if (!apiReady) return;
      const errors = {} as any;
      if (values.walletAddress.endsWith(".eth")) {
        const addressResponse = await api!.getWallet(values.walletAddress);
        if (!addressResponse || !addressResponse.walletAddress) {
          errors.walletAddress = "Invalid ENS name";
        } else {
          setAddress(addressResponse.walletAddress);
        }
        return errors;
      }
      if (!isValidContractAddress(values.walletAddress)) {
        errors.walletAddress = "Invalid address";
        return errors;
      }
      setAddress(values.walletAddress);
      return errors;
    },
    [apiReady],
  );

  const onSubmit = useCallback((values: any) => {
    const condition = {
      contractAddress: "",
      standardContractType: "",
      chain: values.chain,
      method: "",
      parameters: [":userAddress"],
      returnValueTest: {
        comparator: "=",
        value: address,
      },
    };
    debugger;
    return handleCreate(condition as AccessControlCondition);
  }, []);

  const {
    setFieldValue,
    errors,
    touched,
    handleChange,
    handleBlur,
    handleSubmit,
  } = useFormik({
    initialValues: {
      chain: "ethereum",
      walletAddress: "",
    },
    validateOnBlur: true,
    validateOnChange: true,
    validate,
    onSubmit,
  });

  return (
    <form
      id="nftForm"
      style={{
        padding: 0,
      }}
    >
      <FlexRow>
        <Col xs={12}>
          <Flex flexdirection="column">
            <Text theme={"primary"} size="md">
              Choose network:
            </Text>
            <Select
              key="chain"
              onChange={(value) => setFieldValue("chain", value)}
              value={"ethereum"}
              bordered
              size="lg"
              className={"mt-3"}
            >
              {Object.values(appConfig.chains).map((c) => (
                <Option key={c.chainId} value={c.value}>
                  <Flex alignitems={"center"}>
                    <img
                      className={"mr-4"}
                      src={`/images/chainLogos/${c.logo}`}
                      alt={c.label}
                      width={14}
                      height={14}
                    />
                    <Text size="md">{c.label}</Text>
                  </Flex>
                </Option>
              ))}
            </Select>
          </Flex>
        </Col>
        <Col className="mt-6" xs={12}>
          <Flex flexdirection="column">
            <Text theme={"primary"} size="md">
              Wallet address or blockchain domain (e.g. ENS):
            </Text>
            <Input
              placeholder="Address"
              name="walletAddress"
              className="mt-3"
              inputSize={"lg"}
              error={
                touched.walletAddress && errors.walletAddress
                  ? errors.walletAddress
                  : undefined
              }
              onChange={handleChange}
              onBlur={handleBlur}
            />
          </Flex>
        </Col>
      </FlexRow>
      <Row>
        <Col pullLeft>
          <Button
            onClick={handleBack}
            className="mt-7 pl-8 pr-8 "
            size="lg"
            theme="clear"
          >
            Back
          </Button>
        </Col>
        <Col pullRight>
          <Button
            theme="primary"
            type="submit"
            size="lg"
            className="mt-7 pl-8 pr-8"
            disabled={
              Object.keys(touched).length === 0 ||
              (Object.keys(touched).length > 0 &&
                Object.keys(errors).length > 0)
            }
            onClick={handleSubmit as any}
          >
            Add rule
          </Button>
        </Col>
      </Row>
    </form>
  );
};

export default IndividualWallet;
