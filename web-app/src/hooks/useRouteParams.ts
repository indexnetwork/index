// import { useParams } from 'next/navigation';

import { useParams } from "next/navigation";

export const useRouteParams = () => {
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  return { id };
};

// index.network/discovery/:did
// export const useRouteParams = () => {
//   const path = usePathname();
//   const did = decodeURIComponent(path.split('/')[2]);

//   return { did };
// }
