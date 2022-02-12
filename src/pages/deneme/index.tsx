import Button from "components/base/Button";
import Col from "layout/base/Grid/Col";
import Row from "layout/base/Grid/Row";
import PageContainer from "layout/site/PageContainer";
import { NextPageWithLayout } from "types";

const Deneme: NextPageWithLayout = () => (
	<PageContainer>
		<Row
			noGutters
			rowSpacing={3}
			colSpacing={3}
		>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 1</Button>
			</Col>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 2</Button>
			</Col>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 3</Button>
			</Col>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 4</Button>
			</Col>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 5</Button>
			</Col>
			<Col lg={3} md={6} xs={12}>
				<Button block>Button 6</Button>
			</Col>
		</Row>
	</PageContainer>
);

export default Deneme;
