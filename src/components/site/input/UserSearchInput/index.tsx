import Search from "components/base/Search";
import UserCard from "components/site/card/UserCard";
import SelectUserRight from "components/site/select/SelectUserRight";
import React from "react";

export interface UserSearchInputProps { }

const UserSearchInput: React.VFC<UserSearchInputProps> = () => (
	<Search
		inputClass="idx-pr-1"
		placeholder="Invite by username or email address"
		addOnAfter={<SelectUserRight value="view" />}
		open={true}
		defaultValue="Deneme"
	>
		{
			[0, 1, 2].map((u) => (
				<UserCard key={u} title="cnsndeniz@gmail.com" subtitle="Hasn't joined yet, tap to send invitation" />
			))
		}

	</Search>
);

export default UserSearchInput;
