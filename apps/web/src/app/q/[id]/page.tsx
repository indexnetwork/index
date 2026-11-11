import { Navigate, useParams } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";

/**
 * `/q/<questionId>`: a question your agent asked, opened on Home with its
 * card selected. Any question in a group opens the group. Signed out, it goes
 * through sign-in and comes back here.
 */
function QuestionLink() {
  const { id = "" } = useParams();
  const { isAuthenticated, isLoading } = useAuthContext();
  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(`/q/${id}`)}`} replace />;
  }
  return <Navigate to={`/?q=${encodeURIComponent(id)}`} replace />;
}

export default QuestionLink;
export const Component = QuestionLink;
