import React, { useState } from "react";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Input from "components/base/Input";
import Select from "components/base/Select";
import Option from "components/base/Select/Option";
import RadioGroup from "components/base/RadioGroup";
import Button from "components/base/Button";
import Row from "components/layout/base/Grid/Row";
import { AccessControlCondition } from "types/entity";
import { appConfig } from "config";
import { useFormik } from "formik";
import api from "services/api-service";
import { isValidContractAddress } from "utils/helper";

export interface SelectNFTOptionsProps {
	handleBack(): void;
	handleCreate(condition: AccessControlCondition): void;
}

const NFTOptions: React.VFC<SelectNFTOptionsProps> = ({ handleBack, handleCreate }) => {
	const [standardContractType, setStandardContractType] = useState<string>("");
	const getCondition = (values: any) => {
		if (!standardContractType || !values.contractAddress) {
			throw new Error("Please fill in all required fields");
		}
		const newCondition: Partial<AccessControlCondition> = {
			contractAddress: values.contractAddress,
			standardContractType,
			chain: values.chain,
		};
		if (standardContractType === "ERC20" && values.minTokens > 0) {
			newCondition.method = "balanceOf";
			newCondition.parameters = [":userAddress"];
			newCondition.returnValueTest = {
				comparator: ">=",
				value: values.minTokens.toString(),
			};
			return newCondition;
		}
		if (standardContractType === "ERC721") {
			if (values.rightType === "specific" && values.tokenId) {
				newCondition.method = "ownerOf";
				newCondition.parameters = [values.tokenId];
				newCondition.returnValueTest = {
					comparator: "=",
					value: ":userAddress",
				};
				return newCondition;
			}
			if (values.rightType === "any" && values.minTokens) {
				newCondition.method = "balanceOf";
				newCondition.parameters = [":userAddress"];
				newCondition.returnValueTest = {
					comparator: ">=",
					value: values.minTokens.toString(),
				};
				return newCondition;
			}
		}
		if (standardContractType === "ERC1155" && values.tokenId && values.minTokens) {
			newCondition.method = "balanceOf";
			newCondition.parameters = [":userAddress", values.tokenId];
			newCondition.returnValueTest = {
				comparator: ">=",
				value: values.minTokens.toString(),
			};
			return newCondition;
		}

		throw new Error("Please fill in all required fields");
	};

	const validate = async (values: any) => {
		const errors = {} as any;
		if (!values.contractAddress) {
			return errors;
		}
		if (!isValidContractAddress(values.contractAddress)) {
			errors.contractAddress = "Invalid contract address";
			setFieldTouched("contractAddress", true, false);
			return errors;
		}
		const contractData = await api.getContract(values.chain, values.contractAddress, values.tokenId);
		// if (values.contractAddress !== contractAddress || values.chain !== chain) return;
		if (contractData && contractData.tokenType) {
			setStandardContractType(contractData.tokenType);
		} else {
			errors.contractAddress = "Contract not found on this network.";
			setStandardContractType("");
			setFieldTouched("contractAddress", true, false);
			return errors;
		}

		if (standardContractType === "ERC721") {
			if (values.rightType === "specific") {
				if (!values.tokenId) {
					errors.tokenId = "Token ID is required";
					return errors;
				}
				if (values.tokenId && !contractData.token) {
					setFieldTouched("tokenId", true, false);
					errors.tokenId = "Token not found";
					return errors;
				}
			}
			if (values.rightType === "any" && !values.minTokens) {
				errors.minTokens = "Token amount is required";
				return errors;
			}
		}
		if (standardContractType === "ERC1155") {
			if (!values.tokenId) {
				errors.tokenId = "Token ID is required";
				return errors;
			}
			if (values.tokenId && !contractData.token) {
				setFieldTouched("tokenId", true, false);
				errors.tokenId = "Token not found";
			}
			if (!values.minTokens) {
				errors.minTokens = "Token amount is required";
				return errors;
			}
		}

		if (standardContractType === "ERC20" && !values.minTokens) {
			errors.minTokens = "Token amount is required";
			return errors;
		}

		return errors;
	};
	const onSubmit = (values: any) => handleCreate && handleCreate(getCondition(values) as AccessControlCondition);
	const {
 		setFieldValue, setFieldError, setFieldTouched, setErrors,
		values, errors, touched,
		handleChange, handleBlur, handleSubmit, handleReset,
	} = useFormik({
		initialValues: {
			chain: "ethereum",
			rightType: "any",
			contractAddress: "",
			tokenId: "",
			minTokens: 1,
		},
		validateOnBlur: true,
		validateOnChange: true,
		validate,
		onSubmit,
	});

	return (
		<form id="nftForm" style={{
			padding: 0,
		}}>
			<FlexRow>
				<Col xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Choose network:</Text>
						<Select key="chain" onChange={(value) => setFieldValue("chain", value)} value={"ethereum"} bordered size="lg" className={"mt-3"}>
							{
								// eslint-disable-next-line react/jsx-key
								Object.values(appConfig.chains).map((c) => (<Option value={c.value}>
									<Flex alignItems={"center"}>
										<img className={"mr-4"} src={`images/chainLogos/${c.logo}`} alt={c.label} width={14} height={14} />
										<Text size="md">{c.label}</Text>
									</Flex>
								</Option>))
							}
						</Select>
					</Flex>
				</Col>
				<Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Enter token contract address:</Text>
						<Input
							placeholder="ERC20 or ERC721 or ERC1155 Address"
							name="contractAddress"
							type="text"
							className="mt-3"
							inputSize={"lg"}
							error={touched.contractAddress && errors.contractAddress ? errors.contractAddress : undefined}
							onChange={handleChange}
							onBlur={handleBlur}
						/>
					</Flex>
				</Col>
				{!errors.contractAddress && standardContractType === "ERC721" && <Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md" className={"mb-3"}>Give rights to:</Text>
						<RadioGroup key="rightType" value={values.rightType} onSelectionChange={(value) => setFieldValue("rightType", value)} colSize={6}
							items={[
								{
									value: "any",
									title: "Any token",
								},
								{
									value: "specific",
									title: "Specific token",
								},
							]}
						/>
					</Flex>
				</Col>
				}
				{((!errors.contractAddress && standardContractType === "ERC1155") || (standardContractType === "ERC721" && values.rightType === "specific")) &&
					<Col className="mt-6" xs={12}>
						<Flex flexDirection="column">
							<Text theme={"primary"} size="md">Token ID:</Text>
							<Input
								placeholder="##"
								name="tokenId"
								type={"text"}
								value={values.tokenId}
								inputSize={"lg"}
								error={touched.tokenId && errors.tokenId ? errors.tokenId : undefined}
								onChange={handleChange}
								onBlur={handleBlur}
								className="mt-3"
							/>
						</Flex>
					</Col>
				}
				{((!errors.contractAddress && standardContractType === "ERC20") || (!errors.contractAddress && standardContractType === "ERC1155") || (!errors.contractAddress && standardContractType === "ERC721" && values.rightType === "any")) &&
					<Col className="mt-6" xs={12}>
						<Flex flexDirection="column">
							<Text theme={"primary"} size="md">How many token does the wallet need to own:</Text>
							<Input
								placeholder="##"
								step={1}
								id="minTokens"
								name="minTokens"
								error={touched.minTokens && errors.minTokens ? errors.minTokens : undefined}
								onChange={handleChange}
								defaultValue={values.minTokens}
								onBlur={handleBlur}
								inputSize={"lg"}
								type={"number"}
								className="mt-3"
							/>
						</Flex>
					</Col>
				}
			</FlexRow>
			<Row>
				<Col pullLeft>
					<Button
						onClick={handleBack}
						className="mt-7 pl-8 pr-8 "
						size="lg"
						theme="clear"
					>Back</Button>
				</Col>
				<Col pullRight>
					<Button
						theme="primary"
						type="submit"
						size="lg"
						className="mt-7 pl-8 pr-8"
						disabled={Object.keys(touched).length === 0 || (Object.keys(touched).length > 0 && Object.keys(errors).length > 0)}
						onClick={handleSubmit as any}
					>Add rule</Button>
				</Col>
			</Row>
		</form>
	);
};

export default NFTOptions;
