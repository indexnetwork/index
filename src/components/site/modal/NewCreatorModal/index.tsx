import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";

import Button from "components/base/Button";
import { useRouter } from "next/router";
import { useMergedState } from "hooks/useMergedState";
import { useTranslation } from "next-i18next";
import { AccessControlCondition, Indexes } from "types/entity";
import IconGreenAdd from "components/base/Icon/IconGreenAdd";
import IconClock from "components/base/Icon/IconClock";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IconWallet from "components/base/Icon/IconWallet";
import NFTOptions from "./NFTOptions";
import IndividualWallet from "./IndividualWallet";

export interface NewCreatorModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
	handleCreate(condition: AccessControlCondition): void;
}

const NewCreatorModal = ({
	handleCreate,
	...modalProps
} : NewCreatorModalProps) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};

	const [activeForm, setActiveForm] = useState("initial");

	const [crawling, setCrawling] = useState(false);

	const [stream, setStream] = useMergedState<Partial<Indexes>>({
		title: "",
	});

	const [loading, setLoading] = useState(false);

	const handleFormState = async (value: string) => {
		setActiveForm(value);
	};

	return <Modal {...modalProps} size={"fit"} onClose={handleClose} body={(
		<>
			{activeForm === "nft-options" ? (
				<NFTOptions handleCreate={handleCreate} handleBack={() => handleFormState("initial")}></NFTOptions>
			) : activeForm === "new-nft" ? (
				<></>
			) : activeForm === "individual-wallet" ? (
				<IndividualWallet handleBack={() => handleFormState("initial")}></IndividualWallet>
			) : (
				<FlexRow rowGutter={4} rowSpacing={0} rowGap={6} colSpacing={3}>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"card"} onClick={() => handleFormState("nft-options")} className={"px-4 py-6"}>
							<IconClock width={24} height={24}></IconClock>
							<Header level={4} className={"my-4"}>NFT Owners</Header>
							<Text theme={"gray4"} size={"sm"}>Add existing token as a creator rule</Text>
						</Button>
					</Col>
					<Col xs={8}>
						<Button textAlign={"left"} theme={"card"} className={"px-4 py-6"}>
							<IconGreenAdd width={24} height={24}></IconGreenAdd>
							<Header theme={"gray9"} level={4} className={"my-4"}>Create New NFT (soon)</Header>
							<Text theme={"gray4"} size={"sm"}>Create a new token, use as a creator rule, mint NFTs to your creators as you like.</Text>
						</Button>
					</Col>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"card"} onClick={() => handleFormState("individual-wallet")} className={"px-4 py-6"}>
							<IconWallet width={24} height={24}></IconWallet>
							<Header level={4}>Individual Wallet</Header>
						</Button>
					</Col>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"card"} className={"px-4 py-6"}>
							<Header className={"mb-4"} theme={"gray9"} level={4}>DAO Members</Header>
							<Text size={"xs"} className={"tag tag-tag tag-circle tag-outlined"}>SOON</Text>
						</Button>
					</Col>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"card"} className={"px-4 py-6 "}>
							<Header theme={"gray9"} level={4}>POAP Collector (soon)</Header>
						</Button>
					</Col>
				</FlexRow>
			)}
		</>
	)}
	header={<>
		<Header level={2}>Add New Creators</Header>
		<Text className={"mt-4"} element={"p"}>Creators will be able to add items, and delete theirs.</Text>
	</>}
	/>;
};

export default NewCreatorModal;
