import React, { useState } from "react";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Input from "components/base/Input";
import Select from "components/base/Select";
import Option from "components/base/Select/Option";
import Button from "components/base/Button";
import Row from "components/layout/base/Grid/Row";
import { appConfig } from "config";
import { AccessControlCondition } from "types/entity";

export interface SelectNFTOptionsProps {
	handleBack?(): void;
	handleCreate(condition: AccessControlCondition): void;
}

const IndividualWallet: React.VFC<SelectNFTOptionsProps> = ({ handleBack, handleCreate }) => {
	const [condition, setCondition] = useState({
		conditionType: "evmBasic",
		contractAddress: "",
		standardContractType: "",
		chain: "ethereum",
		method: "",
		parameters: [":userAddress"],
		returnValueTest: {
			comparator: "=",
			value: "",
		},
	});
	const handleChainChange = (value: string) => {
		setCondition({ ...condition, chain: value });
	};

	const handleWalletAddressChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		setCondition({ ...condition, returnValueTest: { comparator: "=", value: target.value } });
	};
	const handleSubmit = () => handleCreate && handleCreate(condition as AccessControlCondition);

	return (
		<>
			<FlexRow>
				<Col xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Choose network:</Text>
						<Select onChange={handleChainChange} value={"ethereum"} bordered size="lg" className={"mt-3"}>
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
						<Text theme={"primary"} size="md">Wallet address or blockchain domain (e.g. ENS):</Text>
						<Input
							placeholder="Address"
							name="address"
							className="mt-3"
							inputSize={"lg"}
							value={condition.returnValueTest.value}
							onChange={handleWalletAddressChange}
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

export default IndividualWallet;
