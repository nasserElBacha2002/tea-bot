import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../context/AuthContext';
import { canAccessFlows } from '../utils/authPermissions';

interface Props {
  children: React.ReactElement;
}

export const RequireAdminRoute: React.FC<Props> = ({ children }) => {
  const user = useAuthUser();
  if (!user) return null;
  if (!canAccessFlows(user.role)) {
    return <Navigate to="/conversations" replace />;
  }
  return children;
};
