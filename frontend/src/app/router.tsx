import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { FlowListPage } from '../features/flows/pages/FlowListPage';
import { ConversationEditorPage } from '../features/flows/editor/ConversationEditorPage';
import { RedirectToConversationEditor } from './RedirectToConversationEditor';

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/flows" element={<FlowListPage />} />
          <Route path="/flows/:flowId/conversation" element={<ConversationEditorPage />} />
          <Route path="/flows/:flowId" element={<RedirectToConversationEditor />} />
          <Route path="*" element={<Navigate to="/flows" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
