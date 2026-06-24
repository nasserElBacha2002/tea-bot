import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../features/auth/context/AuthContext';
import { defaultHomePath } from '../features/auth/utils/authPermissions';

export const DefaultHomeRedirect: React.FC = () => {
  const user = useAuthUser();
  return <Navigate to={defaultHomePath(user?.role)} replace />;
};
