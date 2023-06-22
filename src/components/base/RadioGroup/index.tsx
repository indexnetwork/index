import Col from "components/layout/base/Grid/Col";
import FlexRow, { FlexRowProps } from "components/layout/base/Grid/FlexRow";
import { useEffect, useRef, useState } from "react";
import { GridFractionType } from "types";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import Button from "../Button";

export interface RadioGroupItem {
	value: string,
	title: string,
}
export interface RadioGroupProps extends FlexRowProps {
	items: RadioGroupItem[];
	value?: string;
	colSize?: GridFractionType;
	onSelectionChange?(values: string | undefined): void;
	className?: string;
}

const RadioGroup: React.VFC<RadioGroupProps> = ({
	items,
	value,
	colSize,
	onSelectionChange,
	className,
	...rowProps
}) => {
	const [selected, setSelected] = useState(value);
	const randKey = useRef<string>(uuidv4());

	const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		const eValue = (event.target as HTMLButtonElement).value;
		setSelected(eValue);
	};
	useEffect(() => {
		onSelectionChange && onSelectionChange(selected);
	}, [selected]);
	return (
		<FlexRow
			rowSpacing={2}
			colSpacing={1}
			{...rowProps}
			className={cc(
				[
					"radio-group",
					className || "",
				],
			)}
		>
			{
				items.map((btn, index) => (
					<Col key={`radioGroup_${randKey}${index}`} {...(colSize && { xs: colSize })}>
						<Button
							size="md"
							block
							theme="clear"
							value={btn.value}
							className={cc([
								"radio-group-button",
								"btn-borderless",
								value === btn.value ? "radio-group-button-selected" : "",
							])}
							onClick={handleClick}
						>{btn.title}</Button>
					</Col>
				))
			}
		</FlexRow>
	);
};

export default RadioGroup;
