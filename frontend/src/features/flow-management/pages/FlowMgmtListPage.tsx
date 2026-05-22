import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useFlowsCatalog } from '../hooks/useFlowManagement';

export const FlowMgmtListPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: flows, isLoading, isError, error } = useFlowsCatalog();
  const [alert, setAlert] = useState<string | null>(null);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto', width: '100%' }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>
        Flujos
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Gestión de flujos publicados en base de datos (sin archivos JSON).
      </Typography>

      {alert && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setAlert(null)}>
          {alert}
        </Alert>
      )}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nombre</TableCell>
                <TableCell>Clave</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Versión publicada</TableCell>
                <TableCell>Borrador activo</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(flows || []).map((f) => (
                <TableRow key={f.id} hover>
                  <TableCell>{f.name}</TableCell>
                  <TableCell>{f.flowKey}</TableCell>
                  <TableCell>{f.status}</TableCell>
                  <TableCell>
                    {f.publishedVersion?.versionLabel || '—'}
                  </TableCell>
                  <TableCell>{f.draftVersion?.versionLabel || '—'}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => navigate(`/admin/flows/${f.id}/versions`)}
                    >
                      Ver versiones
                    </Button>
                    {f.publishedVersion && (
                      <Button
                        size="small"
                        sx={{ ml: 1 }}
                        onClick={() =>
                          navigate(`/admin/flow-versions/${f.publishedVersion!.id}`)
                        }
                      >
                        Ver publicado
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};
