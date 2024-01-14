import { object, string } from "yup";

const yupValidations = {
	loginForm: object().shape({
		email: string().email().label("Email").required(),
		password: string().label("Password").required(),
	}),

};

export default yupValidations;
