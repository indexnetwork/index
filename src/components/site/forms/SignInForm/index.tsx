import Button from "components/base/Button";
import Input from "components/base/Input";
import { Formik, Form } from "formik";
import React from "react";
import { useTranslation } from "next-i18next";
import yupValidations from "utils/yup-validations";

export type SignInFormData = {
	email: string;
	password: string;
};

const SignInForm = () => {
	const { t } = useTranslation(["components", "common"]);

	const onSubmit = (values: SignInFormData) => {
	};

	return (
		<Formik
			htmlFor="loginForm"
			initialValues={{
				email: "",
				password: "",
			}}
			validationSchema={yupValidations.loginForm}
			onSubmit={onSubmit}
		>
			{({
				errors, touched,
				handleChange,
				handleBlur,
				handleSubmit,
			}) => (
				<Form id="loginForm" style={{
					padding: 0,
				}}>
					<Input
						type="email"
						name="email"
						autoComplete="email"
						error={touched.email && errors.email ? errors.email : undefined}
						onChange={handleChange}
						onBlur={handleBlur}
						placeholder='Email or username' />
					<Input
						type="password"
						name="password"
						error={touched.password && errors.password ? errors.password : undefined}
						placeholder='Password'
						onChange={handleChange}
						onBlur={handleBlur}
						autoComplete="current-password"
					/>
					<div>
						<div>
							<div>
								<div>Forgot your password?</div>
							</div>
							<div>
								<Button type="submit" theme="primary" onClick={handleSubmit as any}>Sign In</Button>
							</div>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
};

export default SignInForm;
