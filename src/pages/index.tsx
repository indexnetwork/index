import React, { ReactElement, useState } from "react";
import Row from "layout/base/Grid/Row";
import Col from "layout/base/Grid/Col";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Tooltip from "components/base/Tooltip";
import ButtonGroup from "components/base/ButtonGroup";
import Button from "components/base/Button";
import IconAdd from "components/base/Icon/IconAdd";
import Flex from "layout/base/Grid/Flex";
import Input from "components/base/Input";
import { NextPageWithLayout } from "types";
import LandingLayout from "layout/site/LandingLayout";
import PageContainer from "layout/site/PageContainer";
import IconSearch from "components/base/Icon/IconSearch";
import IconGoogle from "components/base/Icon/IconGoogle";
import IconTwitter from "components/base/Icon/IconTwitter";
import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import IconShare from "components/base/Icon/IconShare";
import IconTrash from "components/base/Icon/IconTrash";
import Avatar from "components/base/Avatar";
import IconCopy from "components/base/Icon/IconCopy";
import Modal from "components/base/Modal";
import IconClose from "components/base/Icon/IconClose";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import FlexRow from "layout/base/Grid/FlexRow";
import CopyInput from "components/base/CopyInput";
import Spin from "components/base/Spin";

const Home: NextPageWithLayout = () => {
	const [modalOpen, setModalOpen] = useState(false);
	const [modal2Open, setModal2Open] = useState(false);
	const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut ullamcorper congue mauris nec faucibus. Donec rutrum, nisi a gravida dignissim, nibh nibh fermentum elit, ut volutpat elit nibh sed nulla. Morbi eget efficitur ipsum. Donec libero leo, ornare vel enim a, egestas ornare neque. Aenean cursus orci ac ligula iaculis volutpat. Morbi rhoncus consectetur elit, et facilisis nunc rutrum sed. In aliquet id enim a lacinia.";
	return (
		<PageContainer>
			<Row
				rowSpacing={3}
				colSpacing={3}
			>
				<Col xs={12}>
					<Header level={1}>Headers</Header>
					<Row rowSpacing={6}>
						<Col>
							<Header level={6}>Headers Level 6</Header>
						</Col>
						<Col>
							<Header level={5}>Headers Level 5</Header>
						</Col>
						<Col>
							<Header level={4}>Headers Level 4</Header>
						</Col>
						<Col>
							<Header level={3}>Headers Level 3</Header>
						</Col>
						<Col>
							<Header level={2}>Headers Level 2</Header>
						</Col>
						<Col>
							<Header level={1}>Headers Level 1</Header>
						</Col>
					</Row>
				</Col>
				<Col xs={12}>
					<Header level={1}>Text</Header>
					<Row>
						<Col>
							<Text size="xs" element="p" fontWeight={600}>Text xs</Text>
							<Text size="sm" element="p">Text xs</Text>
							<Text size="md" element="p">Text xs</Text>
							<Text size="lg" element="p">Text xs</Text>
							<Text size="md" element="p" theme="primary">Text primary</Text>
							<Text size="md" element="p" theme="secondary">Text secondary</Text>
							<Text size="md" element="p" theme="success">Text secondary</Text>
							<Text size="md" element="p" theme="error">Text secondary</Text>
							<Text size="md" element="p" theme="warning">Text secondary</Text>
						</Col>
					</Row>
				</Col>
				<Col xs={12}>
					<Header level={1}>Buttons</Header>
					<FlexRow
						rowSpacing={3}
						colSpacing={3}
					>
						<Col sm={4} xs={12}>
							<Button size="lg" block>Button lg</Button>
						</Col>
						<Col sm={4} xs={12}>
							<Button size="md" block>Button md</Button>
						</Col>
						<Col sm={4} xs={12}>
							<Button size="sm" block>Button sm</Button>
						</Col>
						<Col sm={4} xs={12}><Button>Button primary</Button></Col>
						<Col sm={4} xs={12}><Button theme="secondary">Button secondary</Button></Col>
						<Col sm={4} xs={12}><Button theme="success">Button success</Button></Col>
						<Col sm={4} xs={12}><Button theme="error">Button error</Button></Col>
						<Col sm={4} xs={12}><Button theme="warning">Button warning</Button></Col>
						<Col sm={4} xs={12}><Button theme="blue">Button blue</Button></Col>
						<Col sm={4} xs={12}><Button theme="ghost">Button ghost</Button></Col>
						<Col sm={4} xs={12}><Button theme="link">Button link</Button></Col>
						<Col sm={4} xs={12}><Button theme="clear">Button clear</Button></Col>
						<Col sm={4} xs={12}>
							<Button theme="primary-outlined">Button primary-outlined</Button>
						</Col>
						<Col sm={4} xs={12}><Button theme="secondary-outlined">Button secondary-outlined</Button></Col>
						<Col sm={4} xs={12}><Button theme="success-outlined">Button success-outlined</Button></Col>
						<Col sm={4} xs={12}><Button theme="error-outlined">Button error-outlined</Button></Col>
						<Col sm={4} xs={12}><Button theme="warning-outlined">Button warning-outlined</Button></Col>
						<Col sm={4} xs={12}>						<Button theme="blue-outlined">Button blue-outlined</Button>
						</Col>
						<Col sm={4} xs={12}>	<Button addOnBefore>
							<IconAdd stroke="white" strokeWidth={"1.5"} />Button Add-On Before
						</Button></Col>
						<Col sm={4} xs={12}>						<Button addOnAfter>Button Add-On Before<IconAdd stroke="white" strokeWidth={"1.5"} /></Button>
						</Col>
						<Col sm={4} xs={12}><Button addOnBefore addOnAfter>
							<IconAdd stroke="white" strokeWidth={"1.5"} />
							Button Add-On Before/After
							<IconAdd stroke="white" strokeWidth={"1.5"} />
						</Button></Col>
						<Col sm={4} xs={12}><Button addOnBefore theme="clear">
							<IconGoogle stroke="white" />
							Button Google
						</Button></Col>
						<Col sm={4} xs={12}><Button addOnBefore theme="clear">
							<IconTwitter fill="var(--twitter-blue)" stroke="var(--twitter-blue)" />
							Button Twitter
						</Button></Col>
					</FlexRow>
				</Col>
				<Col xs={12}>
					<Header level={1}>Dropdown</Header>
					<Row
						rowSpacing={3}
						colSpacing={3}
					>
						<Col lg={3}>
							<Dropdown
								trigger="both"
								position="top-center"
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dd Center W Hover</Button>
							</Dropdown>
						</Col>
						<Col lg={3}>
							<Dropdown
								position="top-left"
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dropdown Top Left</Button>
							</Dropdown>
						</Col>
						<Col lg={3}>
							<Dropdown
								position="top-right"
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dropdown top Right</Button>
							</Dropdown>
						</Col>
					</Row>
					<Row
						rowSpacing={3}
						colSpacing={3}
					>
						<Col lg={3}>
							<Dropdown
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dropdown Center</Button>
							</Dropdown>
						</Col>
						<Col xs={3}>
							<Dropdown
								position="bottom-left"
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dropdown Left</Button>
							</Dropdown>
						</Col>
						<Col xs={3}>
							<Dropdown
								position="bottom-right"
								menuItems={
									<>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconAdd width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Add</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconShare width={12} height="auto" />
												<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
											</Flex>
										</DropdownMenuItem>
										<DropdownMenuItem divider />
										<DropdownMenuItem>
											<Flex alignItems="center">
												<IconTrash width={12} height="auto" className="idx-icon-error" />
												<Text className="idx-ml-3" element="span" size="sm" theme="error" > Add</Text>
											</Flex>
										</DropdownMenuItem>
									</>
								}
							>
								<Button>Dropdown Right</Button>
							</Dropdown>
						</Col>
					</Row>
				</Col>
				<Col xs={12}>
					<Header level={1}>Tooltip</Header>
					<Row
						rowSpacing={3}
						colSpacing={3}
					>
						<Col xs={6}>
							<Tooltip
								content={"Tooltip on text asdasdasdasdasdasdasdasd asdasdasdasdasd asdasdasdasdasdasdasdasd asdasdasdasdasdasd"}
							>
								<Text size="md" element="p" style={{ margin: 0 }}>Try Tooltip</Text>
							</Tooltip>
						</Col>
						<Col xs={6}>
							<Tooltip
								content={"Tooltip on button"}
							>
								<Button>Try Tooltip on Button</Button>
							</Tooltip>
						</Col>
					</Row>

				</Col>
				<Col>
					<Header level={1}>Button Group</Header>
				</Col>
				<Col>
					<ButtonGroup
						theme="clear"
					>
						<Button addOnBefore><IconAdd stroke="var(--gray-4)" /><span>asdasasdasd</span></Button>
						<Button addOnAfter>Button 2 <IconAdd stroke="var(--gray-4)" /></Button>
						<Button>Button 2</Button>
					</ButtonGroup>
				</Col>
				<Col><Header level={1}>Input</Header></Col>
				<Col>
					<Input
						addOnBefore={<IconSearch />}
						type="password"
						placeholder="deneme" />
				</Col>
				<Col>
					<CopyInput
						value="https://asdaasdasdasdsasd.com" />
				</Col>
				<Col>
					<Input />
				</Col>
				<Col xs={12}>
					<Input placeholder="Disabled" disabled addOnBefore={<IconSearch />}
					/>
				</Col>
			</Row>
			<Row>
				<Col xs={12}>
					<Header level={1}>Avatar</Header>
					<FlexRow
						colSpacing={3}
					>
						<Col>
							<Avatar
								randomColor
								size={40}
							>
								S
							</Avatar>
						</Col>
						<Col>
							<Avatar
								randomColor
								size={40}
								shape="square"
							>
								Casdasd
							</Avatar>
						</Col>
						<Col xs={1}>
							<Avatar randomColor size={40}>
								<img
									src="data:image/jpeg;base64,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"
								/>
							</Avatar>
						</Col>
						<Col>
							<Avatar randomColor size={40} hoverable>
								<IconCopy />
							</Avatar>
						</Col>
						<Col>
							<Avatar randomColor size={40} hoverable>
								X
							</Avatar>
						</Col>
						<Col>
							<Avatar randomColor size={20} hoverable>
								X
							</Avatar>
						</Col>
					</FlexRow>
				</Col>
			</Row>
			<Row
				rowSpacing={3}
			>
				<Col>
					<Header level={1} >Modal</Header>
				</Col>
				<Col xs={12}>
					<Button
						onClick={() => {
							setModalOpen((oldVal) => !oldVal);
						}}
					>Toggle Modal</Button>
				</Col>
				<Col xs={12}>
					<Button
						onClick={() => {
							setModal2Open((oldVal) => !oldVal);
						}}
					>Toggle Modal 2</Button>
				</Col>
			</Row>
			<Row>
				<Col>
					<Header level={1} >Tabs</Header>
				</Col>
				<Col>
					<Tabs>
						<TabPane
							tabKey="1"
							title="Tab 1"
							enabled
						>
							Content 1
						</TabPane>
						<TabPane
							tabKey="2"
							title="Tab 2"
							enabled
						>
							Content 2
						</TabPane>
						<TabPane
							tabKey="3"
							title="Disabled"
							enabled={false}
						>
							Content 3
						</TabPane>
					</Tabs>
				</Col>
			</Row>
			<Row>
				<Col>
					<Header level={1}>
							Spin
					</Header>
				</Col>
				<Col xs={4}>
					<Spin
						active={true}
						size="sm"
					>
						<Flex
							style={{
								height: 100,
							}}
						>
						Spin sm
						</Flex>
					</Spin>
				</Col>
				<Col xs={4}>
					<Spin
						active={true}
						size="md"
					>
						<Flex
							style={{
								height: 100,
							}}
						>
						Spin md
						</Flex>
					</Spin>
				</Col>
				<Col xs={4}>
					<Spin
						active={true}
						size="lg"
					>
						<Flex
							style={{
								height: 100,
							}}
						>
						Spin lg
						</Flex>
					</Spin>
				</Col>
			</Row>
			<Modal
				onClose={() => { setModalOpen(false); }}
				visible={modalOpen}
				destroyOnClose={false}
				body={<div>BODY</div>}
				header={<div>HEADER</div>}
				footer={<div>FOOTER</div>}
			>
			</Modal>
			<Modal
				onClose={() => { setModal2Open(false); }}
				visible={modal2Open}
				destroyOnClose={false}
				body={
					<div id="lipsum">
						<p>
							{paragraph}
						</p>
						<p>
							{paragraph}
						</p>
						<p>
							{paragraph}
						</p>
						<p>
							{paragraph}
						</p>
						<p>
							{paragraph}
						</p>
					</div>}
				header={<Flex
					justifyContent="space-between"
				>
					<Header level={5} className="idx-my-0">Share</Header>
					<IconClose
						width={12}
						height={12}
						strokeWidth="2"
						cursor="pointer"
						onClick={() => { setModal2Open(false); }}
					/>
				</Flex>}
				footer={<div>FOOTER 2</div>}
			>
			</Modal>
		</PageContainer>
	);
};

Home.getLayout = function getLayout(page: ReactElement) {
	return (
		<LandingLayout>
			{page}
		</LandingLayout>
	);
};

export default Home;
