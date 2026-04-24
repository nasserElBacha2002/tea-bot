import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { FlowListPage } from '../features/flows/pages/FlowListPage';
import { ConversationEditorPage } from '../features/flows/editor/ConversationEditorPage';
import { RedirectToConversationEditor } from './RedirectToConversationEditor';
import { RequireAuth } from '../features/auth/components/RequireAuth';
import { LoginPage } from '../features/auth/pages/LoginPage';

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/flows" element={<FlowListPage />} />
            <Route path="/flows/:flowId/conversation" element={<ConversationEditorPage />} />
            <Route path="/flows/:flowId" element={<RedirectToConversationEditor />} />
            <Route path="*" element={<Navigate to="/flows" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
