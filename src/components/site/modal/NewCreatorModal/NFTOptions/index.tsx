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

export interface SelectNFTOptionsProps {
	handleBack(): void;
	handleCreate(condition: AccessControlCondition): void;
}

const NFTOptions: React.VFC<SelectNFTOptionsProps> = ({ handleBack, handleCreate }) => {
	const [condition, setCondition] = useState({
		chain: "ethereum",
		standardContractType: "ERC721",
		rightType: "any",
		contractAddress: "",
		tokenId: "",
		minTokens: 1,
	});

	const {
		chain, rightType, standardContractType, contractAddress, tokenId, minTokens,
	} = condition;

	const getCondition = () => {
		if (!standardContractType || !contractAddress) {
			throw new Error("Please fill in all required fields");
		}
		const newCondition: Partial<AccessControlCondition> = {
			conditionType: "evmBasic",
			contractAddress,
			standardContractType,
			chain,
		};
		if (standardContractType === "ERC20" && minTokens > 0) {
			newCondition.method = "balanceOf";
			newCondition.parameters = [":userAddress"];
			newCondition.returnValueTest = {
				comparator: ">=",
				value: minTokens,
			};
			return newCondition;
		}
		if (standardContractType === "ERC721") {
			if (minTokens) {
				newCondition.method = "balanceOf";
				newCondition.parameters = [":userAddress"];
				newCondition.returnValueTest = {
					comparator: ">=",
					value: minTokens,
				};
				return newCondition;
			} if (tokenId) {
				newCondition.method = "ownerOf";
				newCondition.parameters = [tokenId];
				newCondition.returnValueTest = {
					comparator: "=",
					value: ":userAddress",
				};
				return newCondition;
			}
		}
		if (standardContractType === "ERC1155" && tokenId && minTokens) {
			newCondition.method = "balanceOf";
			newCondition.parameters = [":userAddress", tokenId];
			newCondition.returnValueTest = {
				comparator: ">=",
				value: minTokens,
			};
			return newCondition;
		}

		throw new Error("Please fill in all required fields");
	};

	const handleSubmit = () => handleCreate && handleCreate(getCondition() as AccessControlCondition);

	const handleRightTypeChange = (value: string) => {
		value !== condition.rightType && setCondition({
			...condition, rightType: value, tokenId: "", minTokens: 0,
		});
	};
	const handlestandardContractTypeChange = (value: string) => {
		value !== condition.standardContractType && setCondition({
			...condition, standardContractType: value, tokenId: "", minTokens: 0,
		});
	};
	const handleContractAddressChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setCondition({ ...condition, contractAddress: target.value });
	};
	const handleTokenIdChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setCondition({ ...condition, tokenId: target.value });
	};
	const handleMinTokensChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setCondition({ ...condition, minTokens: target.valueAsNumber });
	};

	return (
		<>
			<FlexRow>
				<Col xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Choose network:</Text>
						<Select value={"2"} bordered size="lg" className={"mt-3"}>
							<Option value="view"><Text size="md">Ethereum</Text></Option>
							<Option value="1"><Text size="md">Polygon</Text></Option>
							<Option value="2"><Text size="md">Solana</Text></Option>
							<Option value="3"><Text size="md">Optimism</Text></Option>
						</Select>
					</Flex>
				</Col>
				<Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Enter token contract address:</Text>
						<Input
							placeholder="ERC20 or ERC721 or ERC1155 Address"
							name="contractAddress"
							className="mt-3"
							inputSize={"lg"}
							value={contractAddress}
							onChange={handleContractAddressChange}
						/>
					</Flex>
				</Col>
				<Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md" className={"mb-3"}>Token contract type:</Text>
						<RadioGroup value={standardContractType} onSelectionChange={handlestandardContractTypeChange} colSize={4}
							items={[
								{
									value: "ERC20",
									title: "ERC20",
								},
								{
									value: "ERC721",
									title: "ERC721",
								},
								{
									value: "ERC1155",
									title: "ERC1155",
								},
							]}
						/>
					</Flex>
				</Col>
				{standardContractType === "ERC721" && <Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md" className={"mb-3"}>Give rights to:</Text>
						<RadioGroup value={rightType} onSelectionChange={handleRightTypeChange} colSize={6}
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
				{((standardContractType === "ERC1155") || (standardContractType === "ERC721" && rightType === "specific")) &&
					<Col className="mt-6" xs={12}>
						<Flex flexDirection="column">
							<Text theme={"primary"} size="md">Token ID:</Text>
							<Input
								placeholder="##"
								name="tokenId"
								type={"text"}
								inputSize={"lg"}
								value={tokenId}
								onChange={handleTokenIdChange}
								className="mt-3"
							/>
						</Flex>
					</Col>
				}
				{((standardContractType === "ERC20") || (standardContractType === "ERC1155") || (standardContractType === "ERC721" && rightType === "any")) &&
					<Col className="mt-6" xs={12}>
						<Flex flexDirection="column">
							<Text theme={"primary"} size="md">How many token does the wallet need to own:</Text>
							<Input
								placeholder="##"
								step={1}
								name="minTokens"
								onChange={handleMinTokensChange}
								inputSize={"lg"}
								value={minTokens}
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
						size="lg"
						className="mt-7 pl-8 pr-8"
						onClick={handleSubmit}
					>Add rule</Button>
				</Col>
			</Row>
		</>
	);
};

export default NFTOptions;
