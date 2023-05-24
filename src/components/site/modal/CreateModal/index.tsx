import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import Row from "components/layout/base/Grid/Row";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Input from "components/base/Input";
import Button from "components/base/Button";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useAppSelector } from "hooks/store";
import { useTranslation } from "next-i18next";
import { selectConnection } from "store/slices/connectionSlice";
import { Indexes } from "types/entity";
import CeramicService from "../../../../services/ceramic-service";

export interface CreateModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
}

const CreateModal = ({
	...modalProps
} : any) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};
	const ceramic = useCeramic();
	const handleEnter = (e: any) => {
		if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
			handleCreate();
		}
	};
	const { did } = useAppSelector(selectConnection);

	const [crawling, setCrawling] = useState(false);

	const [title, setTitle] = useState<string>("");

	const [loading, setLoading] = useState(false);

	const handleCreate = async () => {
		setLoading(true);
		if (title) {
			const c = new CeramicService();
			const doc = await c.createIndex({ title } as Indexes);
			if (doc != null) {
				// await setTitle("");
				await router.push(`/${doc.id}`);
				modalProps.onClose?.();
			}
		}
		setLoading(false);
	};
	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		const { value } = target;
		setTitle(value);
	 };

	return <Modal
		{...modalProps}
		size={"xs"}
		body={(
			<>
				<Row
				>
					<Col xs={12}
					>
						<Flex
							alignItems="center"

						>
							<Flex flexDirection="column" flexWrap="wrap" flexGrow={1} className="ml-3">
								<Text size="lg">Title</Text>
							</Flex>
						</Flex>
						<Col sm={12}>
							<Flex>
								<Input
									autoFocus={true}
									value={title || ""}
									inputSize={"lg"}
									onKeyDown={handleEnter}
									onChange={handleChange}
									// loading={loading}
									className="mt-3 ml-3 mr-2"
									placeholder="e.g. Web3 Social Ecosystem"
								/>
							</Flex>
						</Col>
						<Col pullLeft>
							<Button
								className="mt-7 pl-8 pr-8 ml-3"
								size="lg"
								theme="clear"
								onClick={handleClose}
							>Cancel</Button>
						</Col>
						<Col pullRight>
							<Button
								disabled={!title}
								onClick={handleCreate}
								theme="primary"
								size="lg"
								className="mt-7 pl-8 pr-8 mr-2"
							>Create</Button>
						</Col>

					</Col>
				</Row>
			</>
		)}
		header={<Header level={2}>Create New Index</Header>}
	>

	</Modal>;
};

export default CreateModal;
