import Input, { InputProps } from "../Input";
import IconSend from "../Icon/IconSend";

export interface AskInputProps extends InputProps {
}

const AskInput = (
	{
		...inputProps
	}: AskInputProps,
) => (
	<Input
		{...inputProps}
		inputSize={"lg"}
		addOnAfter={<IconSend width={20} height={20} />}
	/>
);

export default AskInput;
