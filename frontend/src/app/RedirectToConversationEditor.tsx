import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** Redirige `/flows/:flowId` al editor de conversación canónico. */
export const RedirectToConversationEditor: React.FC = () => {
  const { flowId } = useParams<{ flowId: string }>();
  return <Navigate to={`/flows/${flowId}/conversation`} replace />;
};
