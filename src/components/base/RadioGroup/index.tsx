import Col from "layout/base/Grid/Col";
import FlexRow, { FlexRowProps } from "layout/base/Grid/FlexRow";
import {
	useCallback, useEffect, useRef, useState,
} from "react";
import { GridFractionType } from "types";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import Button from "../Button";
import Tag from "../Tag";

export interface RadioGroupItem {
	value: string,
	title: string,
}
export interface RadioGroupProps extends FlexRowProps {
	items: RadioGroupItem[];
	value?: string[];
	multiselect?: boolean;
	colSize?: GridFractionType;
	showTags?: boolean;
	onSelectionChange?(values: string[]): void;
}

const RadioGroup: React.VFC<RadioGroupProps> = ({
	items,
	value,
	showTags,
	multiselect = false,
	colSize = 6,
	onSelectionChange,
	...rowProps
}) => {
	const [selected, setSelected] = useState(value || []);
	const randKey = useRef<string>(uuidv4());

	const handleChange = useCallback((btn: string) => () => {
		setSelected((oldVal) => {
			const ind = oldVal.indexOf(btn);
			if (ind === -1) {
				if (multiselect) {
					return [...oldVal, btn];
				}
				return [btn];
			}
			return oldVal.filter((val) => val !== btn);
		});
	}, [multiselect, setSelected, selected]);

	useEffect(() => {
		setSelected(value || []);
	}, [value]);

	useEffect(() => {
		onSelectionChange && onSelectionChange(selected);
	}, [selected]);

	return (
		<FlexRow
			rowSpacing={2}
			colSpacing={2}
			rowGutter={2}
			{...rowProps}
			className="idx-radio-group"
		>
			{
				items.map((btn, index) => (
					<Col key={`radioGroup_${randKey}${index}`} xs={showTags ? undefined : colSize}>
						{
							showTags ? (
								<Tag
									clickable
									text={btn.title}
									theme={selected.indexOf(btn.value) > -1 ? "tag" : "clear"}
									onClick={handleChange(btn.value)}></Tag>
							) : (
								<Button
									size="xs"
									block
									theme="clear"
									className={cc([
										"idx-radio-group-button",
										selected.indexOf(btn.value) > -1 ? "idx-radio-group-button-selected" : "",
									])}
									onClick={handleChange(btn.value)}
								>{btn.title}</Button>
							)
						}
					</Col>
				))
			}
		</FlexRow>
	);
};

export default RadioGroup;
