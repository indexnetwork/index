import React from "react";

export interface InputProps extends React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> {
	error?: string;
}
// const [field, meta] = useField(props as any);
// <input {...field} {...props} error={meta.touched && meta.error ? { content: meta.error, pointing: "above" } : undefined} />
const Input: React.FC<InputProps> = (props) => (
	<input {...props} />
);
export default Input;
