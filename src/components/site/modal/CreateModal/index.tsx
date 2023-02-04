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

export interface CreateModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
}

const CreateModal: React.VFC<CreateModalProps> = ({
	...modalProps
}) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};
	const ceramic = useCeramic();

	const { did } = useAppSelector(selectConnection);

	const [crawling, setCrawling] = useState(false);

	const [title, setTitle] = useState<string>("");

	const [loading, setLoading] = useState(false);

	const handleCreate = async () => {
		setLoading(true);
		if (title) {
			const doc = await ceramic.createIndex({ title } as Indexes);
			if (doc != null) {
				await setTitle("");
				await router.push(`/${did}/${doc.id}`);
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
							className="mb-3"
						>
							<Flex flexDirection="column" flexWrap="wrap" flexGrow={1} className="ml-2">
								<Text>Title</Text>
							</Flex>
						</Flex>
						<Col sm={12}>
							<Input
								value={title || ""}
								onChange={handleChange}
								// loading={loading}
								className="mt-3"
								placeholder="e.g. Curation Over Curation"
							/>
						</Col>
						<Col pullLeft>
							<Button
								className="mt-7 pl-7 pr-7"
								theme="clear"
								onClick={handleClose}
							>&nbsp;Cancel&nbsp;</Button>
						</Col>
						<Col pullRight>
							<Button
								onClick={handleCreate}
								theme="primary"
								className=" mt-7 pl-7 pr-7"
							>&nbsp;Create&nbsp;</Button>
						</Col>

					</Col>
				</Row>
			</>
		)}
		header={<Header level={3}>Create New Index</Header>}
	>

	</Modal>;
};

export default CreateModal;
