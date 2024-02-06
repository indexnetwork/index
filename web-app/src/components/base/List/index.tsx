import { FC, ReactElement, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import cc from "classcat";
import ListItem from "./ListItem";

export interface ListProps<T = {}> {
  data: T[];
  listClass?: string;
  itemContainerClass?: string;
  render(item: T, index: number): ReactElement<any>;
  divided?: boolean;
}

const List: FC<ListProps> = ({
  listClass,
  itemContainerClass,
  render,
  divided = true,
  data,
}) => {
  const containerId = useRef<string>(uuidv4());

  return (
    <ul className={cc(["list", listClass || ""])}>
      {data &&
        data.map((item, index) => (
          <ListItem
            key={`listItem${index}-${containerId}`}
            className={cc([itemContainerClass || ""])}
          >
            {render(item, index)}
            {divided && index !== data.length - 1 && (
              <div className="list-divider"></div>
            )}
          </ListItem>
        ))}
    </ul>
  );
};

export default List;
