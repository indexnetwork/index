import SearchDropdown from "components/base/SearchDropdown";
import UserCard from "components/site/card/UserCard";
import SelectUserRight from "components/site/select/SelectUserRight";
import React from "react";

export interface UserSearchInputProps { }

const UserSearchInput: React.VFC<UserSearchInputProps> = () => (
	<SearchDropdown
		inputClass="idx-pr-1"
		placeholder="Invite by username or email address"
		addOnAfter={<SelectUserRight className="idx-mr-3" value="view" />}
		open={true}
		defaultValue="Deneme"
	>
		{
			[0, 1, 2].map((u) => (
				<UserCard
					className="idx-px-5 idx-py-5 idx-hoverable"
					key={u}
					title="cnsndeniz@gmail.com"
					subtitle="Hasn't joined yet, tap to send invitation" />
			))
		}

	</SearchDropdown>
);

export default UserSearchInput;
