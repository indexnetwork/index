import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import PageContainer from "layout/site/PageContainer";
import PageLayout from "layout/site/PageLayout";
import React, { ReactElement, useEffect, useRef } from "react";
import { NextPageWithLayout } from "types";
import { Form, Formik, FormikProps } from "formik";
import Button from "components/base/Button";
import Input from "components/base/Input";
import { useCeramic } from "hooks/useCeramic";
import type { BasicProfile } from "@datamodels/identity-profile-basic";

const Profile: NextPageWithLayout = () => {
	const ceramic = useCeramic();
	const formikRef = useRef<FormikProps<BasicProfile>>(null);

	const init = async () => {
		const profile = await ceramic.getProfile();
		if (profile) {
			formikRef.current!.setValues(profile);
		}
	};

	useEffect(() => {
		init();
	}, []);

	const handleSubmit = async (values: BasicProfile) => {
		alert("submit");
		const result = await ceramic.setProfile(values);
		alert(result);
	};

	return (
		<PageContainer>
			<Formik<BasicProfile>
				innerRef={formikRef}
				initialValues={{
					name: "",
				}}
				onSubmit={handleSubmit}
			>
				{(props) => (
					<Form>
						<FlexRow
							rowSpacing={3}
							justify="center"
						>
							<Col
								xs={12}
								lg={9}
							>
								<Input
									placeholder="name"
									name="name"
									onChange={props.handleChange}
									onBlur={props.handleBlur}
									value={props.values.name}
								/>
							</Col>
							<Col
								xs={12}
								lg={9}
							>
								<Button type="submit">Submit</Button>
							</Col>
						</FlexRow>
					</Form>
				)}
			</Formik>
		</PageContainer>
	);
};

Profile.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
		>
			{page}
		</PageLayout>
	);
};

Profile.requireAuth = true;

export default Profile;
