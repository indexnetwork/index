import React from "react";
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

interface IndividualWalletOptionsProps {
  handleBack: () => void;
  handleCreate: (condition: AccessControlCondition) => void;
}

const IndividualWallet: React.FC<IndividualWalletOptionsProps> = ({
  handleBack,
  handleCreate,
}) => {
  const { api, ready: apiReady } = useApi();

  const formik = useFormik({
    initialValues: {
      chain: "ethereum",
      walletAddress: "",
    },
    validate: async (values) => {
      const errors: { walletAddress?: string } = {};

      if (!apiReady) return errors;

      if (values.walletAddress.endsWith(".eth")) {
        const addressResponse = await api!.getWallet(values.walletAddress);
        if (!addressResponse || !addressResponse.walletAddress) {
          errors.walletAddress = "Invalid ENS name";
        } else {
          formik.setFieldValue("walletAddress", addressResponse.walletAddress, false);
        }
      } else if (!isValidContractAddress(values.walletAddress)) {
        errors.walletAddress = "Invalid address";
      } else {
        formik.setFieldValue("walletAddress", values.walletAddress, false);
      }

      return errors;
    },

    onSubmit: (values) => {
      const condition = {
        contractAddress: "",
        standardContractType: "",
        chain: values.chain,
        method: "",
        parameters: [":userAddress"],
        returnValueTest: {
          comparator: "=",
          value: values.walletAddress,
        },
      };
      handleCreate(condition as AccessControlCondition);
    },
  });

  return (
    <form onSubmit={formik.handleSubmit} style={{ padding: 0 }}>
      <FlexRow>
        <Col xs={12}>
          <Flex flexdirection="column">
            <Text theme="primary" size="md">
              Choose network:
            </Text>
            <Select
              key="chain"
              onChange={(value) => formik.setFieldValue("chain", value)}
              value={formik.values.chain}
              bordered
              size="lg"
              className="mt-3"
            >
              {Object.values(appConfig.chains).map((c) => (
                <Option key={c.chainId} value={c.value}>
                  <Flex alignitems="center">
                    <img
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
        <Col xs={12} className="mt-6">
          <Flex flexdirection="column">
            <Text theme="primary" size="md">
              Wallet address or blockchain domain (e.g., ENS):
            </Text>
            <Input
              name="walletAddress"
              placeholder="Address"
              className="mt-3"
              inputSize="lg"
              value={formik.values.walletAddress}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={
                formik.touched.walletAddress && formik.errors.walletAddress
                  ? formik.errors.walletAddress
                  : undefined
              }
            />
          </Flex>
        </Col>
      </FlexRow>
      <Row>
        <Col pullLeft>
          <Button
            onClick={handleBack}
            className="mt-7 pl-8 pr-8"
            size="lg"
            theme="clear"
          >
            Back
          </Button>
        </Col>
        <Col pullRight>
          <Button
            type="submit"
            theme="primary"
            size="lg"
            className="mt-7 pl-8 pr-8"
            disabled={!formik.isValid || formik.isSubmitting}
          >
            Add rule
          </Button>
        </Col>
      </Row>
    </form>
  );
};

export default IndividualWallet;
