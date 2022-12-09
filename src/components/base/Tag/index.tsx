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
	inputActive?: boolean;
	clickable?: boolean;
	placeholder?: string;
	theme?: ButtonThemeType;
	size?: InputSizeType;
	shape?: ShapeType;
	onClick?(): void;
	onEdit?(val?: string | null): void;
	onRemove?(val: string): void;
}

const Tag: React.FC<TagProps> = ({
	text,
	className,
	placeholder,
	clickable,
	removable = false,
	editable = false,
	theme = "tag",
	size = "md",
	shape = "circle",
	inputActive = false,
	onClick,
	onRemove,
	onEdit,
	...divProps
}) => {
	const divRef = useRef<HTMLDivElement>(null);
	const [value, setValue] = useState<string | null | undefined>(text);
	const [editActive, setEditActive] = useState(inputActive);

	const handleRemove = (e: any) => {
		if (e) {
			e.stopPropagation();
		}
		onRemove && onRemove(value!);
	};

	const handleEditActiveToggle = () => {
		editable && !editActive && setEditActive((oldVal) => !oldVal);
		clickable && onClick && onClick();
	};

	useEffect(() => {
		if (!editable) {
			setEditActive(false);
		}
	}, [editable]);

	const handleValueChange = ({ target }: any) => {
		if (target) {
			setValue(target.value);
		}
	};

	const handleClose = () => {
		setEditActive(false);
		onEdit && onEdit(value?.toLowerCase());
	};

	const handleEnter = (e: any) => {
		if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
			e.preventDefault();
			handleClose();
		}
	};

	useBackdropClick(divRef, handleClose, editActive);

	useEffect(() => {
		setEditActive(inputActive || false);
	}, [inputActive]);

	return (
		<div
			{...divProps}
			ref={divRef}
			className={cc(
				[
					"tag",
					`tag-${theme}`,
					`tag-${size}`,
					`tag-${shape}`,
					clickable ? "tag-clickable" : "",
					removable ? "tag-removable" : "",
					editable && !editActive ? "tag-editable" : "",
					className,
				],
			)}
			onClick={handleEditActiveToggle}
		>
			{editable && editActive ? <Input
				autoFocus
				inputSize="sm"
				type="text"
				ghost
				className="idex-tag-input"
				placeholder={placeholder}
				onChange={handleValueChange}
				onKeyDown={handleEnter}
				onBlur={handleClose}
			/> : value}
			{removable && !editActive &&
				<div
					className="tag-remove"
					onClick={removable ? handleRemove : undefined}
				>
					<IconClose className="tag-remove-icon" />
				</div>
			}
		</div>
	);
};

export default Tag;
