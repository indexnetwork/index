import React, { ReactElement } from "react";
import Row from "layout/base/Grid/Row";
import Col from "layout/base/Grid/Col";
import Header from "components/base/Header";
import Text from "components/base/Text";
import CopyInput from "components/base/CopyInput";
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

const Home: NextPageWithLayout = () => (
	<PageContainer style={{
		height: 1000,
	}}>
		<Row>
			<Col xs={"12"}>
				<Header level={1}>Headers</Header>
				<Row>
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
			<Col xs={"12"}>
				<Header level={1}>Text</Header>
				<Row>
					<Col>
						<Text size="xs" element="p">Text xs</Text>
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
			<Col xs={"12"}>
				<Header level={1}>Buttons</Header>
				<Row>
					<Col>
						<Button size="lg">Button large</Button>
						<Button size="md">Button medium</Button>
						<Button size="sm">Button small</Button>
					</Col>
					<Col>
						<Button>Button primary</Button>
						<Button theme="secondary">Button secondary</Button>
						<Button theme="success">Button success</Button>
						<Button theme="error">Button error</Button>
						<Button theme="warning">Button warning</Button>
						<Button theme="blue">Button blue</Button>
						<Button theme="ghost">Button ghost</Button>
						<Button theme="link">Button link</Button>
						<Button theme="clear">Button clear</Button>
						<Button theme="primary-outlined">Button primary-outlined</Button>
						<Button theme="secondary-outlined">Button secondary-outlined</Button>
						<Button theme="success-outlined">Button success-outlined</Button>
						<Button theme="error-outlined">Button error-outlined</Button>
						<Button theme="warning-outlined">Button warning-outlined</Button>
						<Button theme="blue-outlined">Button blue-outlined</Button>
						<Button addOnBefore>
							<IconAdd stroke="white" strokeWidth={"1.5"} />Button Add-On Before
						</Button>
						<Button addOnAfter>Button Add-On Before<IconAdd stroke="white" strokeWidth={"1.5"} /></Button>
						<Button addOnBefore addOnAfter>
							<IconAdd stroke="white" strokeWidth={"1.5"} />
							Button Add-On Before/After
							<IconAdd stroke="white" strokeWidth={"1.5"} />
						</Button>
						<Button addOnBefore theme="clear">
							<IconGoogle stroke="white" />
							Button Google
						</Button>
						<Button addOnBefore theme="clear">
							<IconTwitter fill="var(--twitter-blue)" stroke="var(--twitter-blue)" />
							Button Twitter
						</Button>
					</Col>
				</Row>
			</Col>
			<Col xs={"12"}>
				<Header level={1}>Dropdown</Header>
				<Row>
					<Col xs="3">
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
							<Button>Dropdown Top Center Hover</Button>
						</Dropdown>
					</Col>
					<Col xs="3">
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
					<Col xs="3">
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
				<Row>
					<Col xs="3">
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
					<Col xs="3">
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
					<Col xs="3">
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
			<Col xs={"12"}>
				<Header level={1}>Tooltip</Header>
				<Row>
					<Col xs="6">
						<Tooltip
							content={"Tooltip on text asdasdasdasdasdasdasdasd asdasdasdasdasd asdasdasdasdasdasdasdasd asdasdasdasdasdasd"}
						>
							<Text size="md" element="p" style={{ margin: 0 }}>Try Tooltip</Text>
						</Tooltip>
					</Col>
					<Col xs="6">
						<Tooltip
							content={"Tooltip on button"}
						>
							<Button>Try Tooltip on Button</Button>
						</Tooltip>
					</Col>
				</Row>

			</Col>
			<Col>
				<CopyInput
					value="https://asdaasdasdasdsasd.com" />
			</Col>
			<Col>
				<Flex>
					<Input />
					<ButtonGroup
						theme="clear"
						style={{
							marginLeft: 20,
						}}
					>
						<Button addOnBefore><IconAdd stroke="var(--gray-4)" /><span>asdasasdasd</span></Button>
						<Button addOnAfter>Button 2 <IconAdd stroke="var(--gray-4)" /></Button>
						<Button>Button 2</Button>
					</ButtonGroup>
				</Flex>
			</Col>
			<Col><Header level={1}>Deneme 1</Header></Col>
			<Col>
				<Input
					addOnBefore={<IconSearch />}
					type="password"
					placeholder="deneme" />
			</Col>
			<Col lg="3" sm="6" xs="12"><Input placeholder="deneme" disabled addOnBefore={<IconSearch />}
			/></Col>
			<Col lg="3" sm="6" xs="12"><Text theme="secondary">Deneme Text</Text></Col>
			<Col lg="3" sm="6" xs="12"><Button theme="ghost">Deneme</Button></Col>
		</Row>
	</PageContainer>
);

Home.getLayout = function getLayout(page: ReactElement) {
	return (
		<LandingLayout>
			{page}
		</LandingLayout>
	);
};

export default Home;
