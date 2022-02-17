import { ButtonThemeType, InputSizeType, ShapeType } from "types";
import cc from "classcat";
import { useEffect, useRef, useState } from "react";
import useBackdropClick from "hooks/useBackdropClick";
import Input from "../Input";
import IconClose from "../Icon/IconClose";

export interface TagProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	text: string;
	removable?: boolean;
	editable?: boolean;
	placeholder?: string;
	theme?: ButtonThemeType;
	size?: InputSizeType;
	shape?: ShapeType;
	onRemove?(): void;
}

const Tag: React.FC<TagProps> = ({
	text,
	className,
	placeholder,
	removable = false,
	editable = false,
	theme = "tag",
	size = "md",
	shape = "circle",
	onRemove,
	...divProps
}) => {
	const divRef = useRef<HTMLDivElement>(null);

	const [value, setValue] = useState<string | null | undefined>(text);
	const [editActive, setEditActive] = useState(false);

	const handleRemove = (e: any) => {
		if (e) {
			e.stopPropagation();
		}
		onRemove && onRemove();
	};

	const handleEditActiveToggle = () => {
		editable && !editActive && setEditActive((oldVal) => !oldVal);
	};

	useEffect(() => {
		if (!editable) {
			setEditActive(false);
		}
	}, [editable]);

	const handleValueChange = (e: any) => {
		if (e && e.target) {
			setValue(e.target.value);
		}
	};

	const handleClose = () => {
		setEditActive(false);
	};

	const handleEnter = (e: any) => {
		if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
			e.preventDefault();
			handleClose();
		}
	};

	useBackdropClick(divRef, handleClose, editActive);

	return (
		<div
			{...divProps}
			ref={divRef}
			className={cc(
				[
					"idx-tag",
					`idx-tag-${theme}`,
					`idx-tag-${size}`,
					`idx-tag-${shape}`,
					removable ? "idx-tag-removable" : "",
					editable && !editActive ? "idx-tag-editable" : "",
					className,
				],
			)}
			onClick={handleEditActiveToggle}
		>
			{editable && editActive ? <Input
				inputSize="sm"
				ghost
				className="idex-tag-input"
				placeholder={placeholder}
				onChange={handleValueChange}
				onKeyDown={handleEnter}
				onBlur={handleClose}
			/> : value}
			{removable && !editActive &&
				<div
					className="idx-tag-remove"
					onClick={removable ? handleRemove : undefined}
				>
					<IconClose className="idx-tag-remove-icon" />
				</div>
			}
		</div>
	);
};

export default Tag;
