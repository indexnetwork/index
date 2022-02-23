import Tag, { TagProps } from "components/base/Tag";
import React from "react";

export interface TagIndexDetailItemProps extends TagProps {
}

const TagIndexDetailItem: React.VFC<TagIndexDetailItemProps> = ({
	onRemove,
	text,
	...tagProps
}) => {
	const handleRemove = () => {

	};
	return (
		<Tag
			{...tagProps}
			text={text || ""}
			onRemove={handleRemove}
		></Tag>
	);
};

export default TagIndexDetailItem;
