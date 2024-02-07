// import { useAppSelector } from "hooks/store";
// import { useAuth } from "hooks/useAuth";
// import { useRouter } from "next/navigation";
// import React, { ReactElement, useContext } from "react";
// import { selectConnection } from "store/slices/connectionSlice";
// import { isSSR } from "utils/helper";
// import { AuthContext, AuthStatus } from "../context/AuthContext";

// const AuthGuard = (props: { children: ReactElement }) => {
//   const router = useRouter();

//   const { status } = useContext(AuthContext); // Consume AuthContext

//   if (status === AuthStatus.LOADING) {
//     return <div>Loading</div>;
//   }

//   // TODO: use cookie and server side rendering to check if user is authenticated
//   // if status is not connected and not the home page, redirect to home page
//   if (router.pathname !== "/") {
//     if (status !== AuthStatus.CONNECTED) {
//       if (!isSSR()) {
//         router.push("/");
//       }
//       return null;
//     } else {
//       return props.children!;
//     }
//   } else {
//     return props.children!;
//   }
// };

// export default AuthGuard;
