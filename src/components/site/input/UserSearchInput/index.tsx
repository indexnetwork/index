import SearchDropdown from "components/base/SearchDropdown";
import UserCard from "components/site/card/UserCard";
import SelectUserRight from "components/site/select/SelectUserRight";
import React from "react";

export interface UserSearchInputProps { }

const UserSearchInput: React.VFC<UserSearchInputProps> = () => (
	<SearchDropdown
		inputClass="pr-1"
		placeholder="Invite by username or email address"
		addOnAfter={<SelectUserRight className="mr-3" value="view" />}
		open={true}
		defaultValue="Deneme"
	>
		{
			[0, 1, 2].map((u) => (
				<UserCard
					className="px-5 py-5 hoverable"
					key={u}
					title="cnsndeniz@gmail.com"
					subtitle="Hasn't joined yet, tap to send invitation" />
			))
		}

	</SearchDropdown>
);

export default UserSearchInput;
