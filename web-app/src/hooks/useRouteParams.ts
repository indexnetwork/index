// import { useParams } from 'next/navigation';

import { useParams } from "next/navigation"

export const useRouteParams = () => {
  const params = useParams();
  const did = decodeURIComponent(params.did as string);

  return { did };
};


// index.network/discovery/:did
// export const useRouteParams = () => {
//   const path = usePathname();
//   const did = decodeURIComponent(path.split('/')[2]);

//   return { did };
// }

