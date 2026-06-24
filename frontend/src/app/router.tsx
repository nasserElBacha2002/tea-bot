import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { FlowListPage } from '../features/flows/pages/FlowListPage';
import { ConversationEditorPage } from '../features/flows/editor/ConversationEditorPage';
import { RedirectToConversationEditor } from './RedirectToConversationEditor';
import { RequireAuth } from '../features/auth/components/RequireAuth';
import { RequireAdminRoute } from '../features/auth/components/RequireAdminRoute';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ConversationsPage } from '../features/conversations/pages/ConversationsPage';
import { DefaultHomeRedirect } from './DefaultHomeRedirect';

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/conversations" element={<ConversationsPage />} />
            <Route
              path="/admin/flows"
              element={
                <RequireAdminRoute>
                  <Navigate to="/flows" replace />
                </RequireAdminRoute>
              }
            />
            <Route
              path="/admin/flows/*"
              element={
                <RequireAdminRoute>
                  <Navigate to="/flows" replace />
                </RequireAdminRoute>
              }
            />
            <Route
              path="/admin/flow-versions/*"
              element={
                <RequireAdminRoute>
                  <Navigate to="/flows" replace />
                </RequireAdminRoute>
              }
            />
            <Route
              path="/flows"
              element={
                <RequireAdminRoute>
                  <FlowListPage />
                </RequireAdminRoute>
              }
            />
            <Route
              path="/flows/:flowId/conversation"
              element={
                <RequireAdminRoute>
                  <ConversationEditorPage />
                </RequireAdminRoute>
              }
            />
            <Route
              path="/flows/:flowId"
              element={
                <RequireAdminRoute>
                  <RedirectToConversationEditor />
                </RequireAdminRoute>
              }
            />
            <Route path="*" element={<DefaultHomeRedirect />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
