import Dropdown from "components/base/Dropdown";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Text from "components/base/Text";
import React from "react";

export type SortPopupSelection = "newest" | "oldest" | "tag" | "default";

export interface SortPopupProps {
	onChange?(type: SortPopupSelection): void;
}
const SortPopup: React.FC<SortPopupProps> = ({ children, onChange }) => {
	const handleClick = (type: SortPopupSelection) => {
		onChange && onChange(type);
	};

	return (
		<Dropdown
			position="bottom-right"
			menuItems={
				<>
					<DropdownMenuItem
						onClick={() => handleClick("newest")}
					>
						<Text element="span" size="sm" theme="secondary">Newest First</Text>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => handleClick("oldest")}
					>
						<Text element="span" size="sm" theme="secondary">Oldest First</Text>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => handleClick("tag")}
					>
						<Text element="span" size="sm" theme="secondary">Most Tagged</Text>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => handleClick("default")}
					>
						<Text element="span" size="sm" theme="secondary">Default</Text>
					</DropdownMenuItem>
				</>
			}
		>
			{children}
		</Dropdown>
	);
};

export default SortPopup;
