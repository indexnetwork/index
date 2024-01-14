import Tag, { TagProps } from "components/base/Tag";
import React from "react";

export interface TagIndexDetailItemProps extends TagProps {
}

const TagIndexDetailItem: React.VFC<TagIndexDetailItemProps> = ({
	onRemove,
	text,
	...tagProps
}) => (
	<Tag
		{...tagProps}
		text={text || ""}
		onRemove={onRemove}
	></Tag>
);

export default TagIndexDetailItem;
