import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  ArrowBack,
  Save,
  Build,
  PlayArrow,
  CloudUpload,
  Add,
  Download,
} from '@mui/icons-material';
import { downloadFlowJson } from '../utils/downloadFlowJson';
import { flowsApi } from '../api/flowsApi';
import {
  flowKeys,
  useFlow,
  useImportJsonAsNewVersion,
  useUpdateFlow,
  useValidateFlow,
} from '../hooks/useFlows';
import { EMPTY_PUBLISH_FLOW, EMPTY_PUBLISH_VM } from './state/publishFallbackModels';
import { useConversationPublish } from './state/useConversationPublish';
import { PublishReviewDialog } from './components/PublishReviewDialog';
import { PublishConfirmDialog } from './components/PublishConfirmDialog';
import { RiskyPublishDialog } from './components/RiskyPublishDialog';
import { conversationViewModelToFlow, flowToConversationViewModel } from './model/conversationAdapters';
import {
  buildConversationValidationSummary,
  firstInvalidStepIdInDisplayOrder,
} from './model/conversationValidation';
import {
  extractNodeIdFromNodoError,
  mapBackendFlowErrorToUserMessage,
} from './model/mapBackendFlowError';
import { useConversationEditor } from './state/useConversationEditor';
import { StepsIndex } from './components/StepsIndex';
import { SimulatorPanel } from './components/SimulatorPanel';
import { StepCard } from './components/StepCard';
import { MoreToolsPanel } from './components/MoreToolsPanel';
import { FlowMetadataDialog } from './components/FlowMetadataDialog';
import { ImportJsonVersionDialog } from './components/ImportJsonVersionDialog';
import {
  runLocalValidationBeforeSave,
  SAVE_MESSAGES,
  type SaveFlowPhase,
} from './model/conversationSaveFlow';

function statusLabel(status: string, version: string): { main: string; sub?: string } {
  if (status === 'published') return { main: 'En vivo', sub: version !== 'draft' ? version : undefined };
  if (status === 'archived') return { main: 'Archivado' };
  return { main: 'En preparación', sub: version === 'draft' ? 'Borrador' : version };
}

export const ConversationEditorPage: React.FC = () => {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const queryClient = useQueryClient();

  const { data: remoteFlow, isLoading, isError } = useFlow(flowId!);
  const updateFlow = useUpdateFlow(flowId!);
  const validateFlow = useValidateFlow();
  const validateImportFlow = useValidateFlow();
  const importJsonMutation = useImportJsonAsNewVersion();

  const serverViewModel = useMemo(
    () => (remoteFlow ? flowToConversationViewModel(remoteFlow) : null),
    [remoteFlow]
  );

  const stepRefs = useRef<Record<string, HTMLElement | null>>({});
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [savePhase, setSavePhase] = useState<SaveFlowPhase>('idle');
  const [indexQuery, setIndexQuery] = useState('');
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const [simulatorEnabled, setSimulatorEnabled] = useState(false);

  const scrollToStep = useCallback((internalId: string, opts?: { focusMessage?: boolean }) => {
    setActiveStepId(internalId);
    setIndexDrawerOpen(false);
    requestAnimationFrame(() => {
      const el = stepRefs.current[internalId];
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (opts?.focusMessage) {
        requestAnimationFrame(() => {
          document.getElementById(`step-message-input-${internalId}`)?.focus();
        });
      }
    });
  }, []);

  const editor = useConversationEditor({
    serverViewModel,
    remoteFlowId: flowId!,
    baseFlow: remoteFlow,
    onCreatedStep: id => scrollToStep(id, { focusMessage: true }),
  });

  const saveDraftForPublish = useCallback(async () => {
    if (!remoteFlow || !editor.viewModel || !editor.dirty) return;
    if (editor.validationIssues.length > 0) {
      throw new Error(
        'El borrador tiene errores de validación. Corregilos antes de guardar o publicar.'
      );
    }
    const saved = await updateFlow.mutateAsync(editor.buildSavePayload(remoteFlow));
    editor.hydrateFromServer(flowToConversationViewModel(saved));
  }, [remoteFlow, editor, updateFlow]);

  const handleRestoreFromHistory = useCallback(async () => {
    if (!flowId) return;
    await queryClient.invalidateQueries({ queryKey: flowKeys.detail(flowId) });
    const fresh = await queryClient.fetchQuery({
      queryKey: flowKeys.detail(flowId),
      queryFn: () => flowsApi.get(flowId),
    });
    editor.hydrateFromServer(flowToConversationViewModel(fresh));
    setSnackbar({
      open: true,
      message: 'Borrador actualizado desde el historial.',
      severity: 'success',
    });
  }, [flowId, queryClient, editor]);

  const handleSaveChanges = useCallback(async () => {
    if (!remoteFlow || !editor.viewModel || !editor.dirty) return;
    setSnackbar(s => ({ ...s, open: false }));

    const local = runLocalValidationBeforeSave(editor.viewModel, editor.validationIssues);
    if (!local.ok) {
      if (local.focusStepId) scrollToStep(local.focusStepId, { focusMessage: true });
      setSnackbar({ open: true, message: local.message, severity: 'error' });
      return;
    }

    const payload = editor.buildSavePayload(remoteFlow);
    let phase: SaveFlowPhase = 'validating';
    setSavePhase(phase);
    try {
      const res = await validateFlow.mutateAsync(payload);
      if (!res.valid) {
        setSnackbar({
          open: true,
          message: res.error ?? SAVE_MESSAGES.serverValidationFailed,
          severity: 'error',
        });
        return;
      }

      phase = 'saving';
      setSavePhase(phase);
      const saved = await updateFlow.mutateAsync(payload);
      editor.hydrateFromServer(flowToConversationViewModel(saved));
      setSnackbar({
        open: true,
        message: SAVE_MESSAGES.success,
        severity: 'success',
      });
    } catch (e: unknown) {
      const raw =
        (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
        (e instanceof Error ? e.message : undefined);

      if (phase === 'saving') {
        const vm = editor.viewModel;
        const stepTitles = vm.steps.map(s => ({ internalId: s.internalId, title: s.title }));
        const userMsg = raw
          ? mapBackendFlowErrorToUserMessage(raw, stepTitles)
          : SAVE_MESSAGES.persistenceFailed;
        const nodeId = raw ? extractNodeIdFromNodoError(raw) : null;
        if (nodeId && vm.steps.some(s => s.internalId === nodeId)) {
          scrollToStep(nodeId, { focusMessage: true });
        }
        setSnackbar({ open: true, message: userMsg, severity: 'error' });
      } else {
        setSnackbar({
          open: true,
          message: raw ?? SAVE_MESSAGES.serverValidationFailed,
          severity: 'error',
        });
      }
    } finally {
      setSavePhase('idle');
    }
  }, [remoteFlow, editor, updateFlow, validateFlow, scrollToStep]);

  const handleValidate = useCallback(async () => {
    if (!remoteFlow || !editor.viewModel) return;
    setSnackbar(s => ({ ...s, open: false }));

    if (editor.validationIssues.length > 0) {
      const vm = editor.viewModel;
      const summary =
        buildConversationValidationSummary(vm, editor.validationIssues) ||
        'Revisá los avisos antes de validar el borrador.';
      const first = firstInvalidStepIdInDisplayOrder(vm, editor.validationIssues);
      if (first) scrollToStep(first, { focusMessage: true });
      setSnackbar({ open: true, message: summary, severity: 'error' });
      return;
    }

    try {
      const payload = editor.buildSavePayload(remoteFlow);
      const res = await validateFlow.mutateAsync(payload);
      setSnackbar({
        open: true,
        message: res.valid
          ? 'El borrador es válido según el servidor.'
          : `Validación: ${res.error ?? 'revisá el flujo'}`,
        severity: res.valid ? 'success' : 'error',
      });
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error ?? (e instanceof Error ? e.message : 'Error al validar');
      setSnackbar({ open: true, message: msg, severity: 'error' });
    }
  }, [remoteFlow, editor, validateFlow, scrollToStep]);

  const handleDownloadJson = useCallback(async () => {
    if (!flowId) return;
    setDownloadingJson(true);
    try {
      await downloadFlowJson(flowId);
      setSnackbar({ open: true, message: 'JSON descargado correctamente.', severity: 'success' });
    } catch (e: unknown) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'No se pudo descargar el flujo.',
        severity: 'error',
      });
    } finally {
      setDownloadingJson(false);
    }
  }, [flowId]);

  const registerStepRef = useCallback((id: string, el: HTMLElement | null) => {
    stepRefs.current[id] = el;
  }, []);

  const vm = editor.viewModel;
  const publishDraftVm = vm ?? serverViewModel;
  const publish = useConversationPublish({
    flowId: flowId ?? '',
    draftVm: publishDraftVm ?? EMPTY_PUBLISH_VM,
    baseFlow: remoteFlow ?? EMPTY_PUBLISH_FLOW,
    editorDirty: editor.dirty,
    saveDraft: saveDraftForPublish,
  });

  const draftFlowForSimulator = useMemo(
    () => (vm && remoteFlow ? conversationViewModelToFlow(vm, remoteFlow) : null),
    [vm, remoteFlow]
  );

  const globalIssues = useMemo(() => {
    if (!vm) return [];
    return editor.validationIssues.filter(
      i => i.code === 'ENTRY_STEP_MISSING' || i.code === 'FALLBACK_STEP_MISSING'
    );
  }, [editor.validationIssues, vm]);

  if (isLoading || !remoteFlow) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !serverViewModel) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">No se pudo cargar la conversación.</Typography>
        <Button component={RouterLink} to="/flows" sx={{ mt: 2 }}>
          Volver al listado
        </Button>
      </Box>
    );
  }

  if (!vm) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const selectedStepId = activeStepId ?? vm.steps[0]?.internalId ?? null;
  const selectedStepIndex = selectedStepId
    ? vm.steps.findIndex(step => step.internalId === selectedStepId)
    : -1;
  const selectedStep =
    selectedStepIndex >= 0 ? vm.steps[selectedStepIndex] : vm.steps[0] ?? null;

  const st = statusLabel(vm.status, vm.version);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px)',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Paper square elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', zIndex: 2 }}>
        <Toolbar variant="dense" sx={{ gap: 1, flexWrap: 'wrap', minHeight: 56 }}>
          <IconButton edge="start" onClick={() => navigate('/flows')} size="small" aria-label="Volver">
            <ArrowBack />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 160 }}>
            <Typography variant="subtitle1" fontWeight={800} noWrap>
              {vm.flowName}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip label={st.main} size="small" color={vm.status === 'published' ? 'success' : 'default'} />
              {st.sub && <Chip label={st.sub} size="small" variant="outlined" />}
              {(savePhase !== 'idle' || updateFlow.isPending) && (
                <Chip
                  label={savePhase === 'validating' ? 'Validando…' : 'Guardando…'}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              )}
              {!updateFlow.isPending && editor.dirty && (
                <Chip label="Cambios sin guardar" size="small" color="warning" variant="outlined" />
              )}
              <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 0.5 }}>
                Editor de conversación
              </Typography>
            </Box>
          </Box>

          <Button
            size="small"
            variant="contained"
            color="primary"
            startIcon={<Save />}
            disabled={
              !editor.dirty ||
              isLoading ||
              savePhase !== 'idle' ||
              updateFlow.isPending ||
              validateFlow.isPending
            }
            onClick={() => void handleSaveChanges()}
          >
            {savePhase === 'validating'
              ? 'Validando…'
              : savePhase === 'saving' || updateFlow.isPending
                ? 'Guardando…'
                : 'Guardar cambios'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlayArrow />}
            onClick={() => (isMdUp ? setSimulatorEnabled(v => !v) : setSimulatorOpen(true))}
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
          >
            Probar
          </Button>
          {isMdUp && (
            <Button
              size="small"
              variant={simulatorEnabled ? 'contained' : 'outlined'}
              startIcon={<PlayArrow />}
              onClick={() => setSimulatorEnabled(v => !v)}
            >
              {simulatorEnabled ? 'Pausa prueba' : 'Probar conversación'}
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            color="secondary"
            startIcon={<CloudUpload />}
            disabled={
              !publish.canOpenPublish ||
              publish.isPublishing ||
              savePhase !== 'idle' ||
              updateFlow.isPending ||
              !publishDraftVm
            }
            onClick={() => publish.startPublishFlow()}
          >
            {publish.isPublishing ? 'Publicando…' : 'Poner en vivo'}
          </Button>
          {isMdUp && (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                onClick={() => void handleDownloadJson()}
                disabled={downloadingJson}
              >
                Descargar JSON
              </Button>
              <Button size="small" variant="outlined" onClick={() => setImportJsonOpen(true)}>
                Importar JSON
              </Button>
            </>
          )}
          <Button
            size="small"
            variant={moreToolsOpen ? 'contained' : 'outlined'}
            color="inherit"
            startIcon={<Build />}
            onClick={() => setMoreToolsOpen(o => !o)}
            sx={{ ml: { md: 0 }, order: { xs: 10, md: 0 } }}
          >
            Más herramientas
          </Button>
          {!isMdUp && (
            <Button size="small" variant="outlined" onClick={() => setIndexDrawerOpen(true)}>
              Índice
            </Button>
          )}
        </Toolbar>

      </Paper>

      <Drawer
        anchor="right"
        open={moreToolsOpen}
        onClose={() => setMoreToolsOpen(false)}
        PaperProps={{
          sx: { width: { xs: '100%', sm: 440, md: 480 }, maxWidth: '100vw' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Más herramientas
          </Typography>
          <Button size="small" onClick={() => setMoreToolsOpen(false)}>
            Cerrar
          </Button>
        </Box>
        {draftFlowForSimulator && moreToolsOpen && (
          <MoreToolsPanel
            flowId={flowId!}
            viewModel={vm}
            draftFlow={draftFlowForSimulator}
            editorDirty={editor.dirty}
            focusNodeId={selectedStepId}
            compactToolbar={!isMdUp}
            onRestoreSuccess={handleRestoreFromHistory}
            onConnectionRowActivate={row => scrollToStep(row.originStepId)}
            onValidateWithoutSave={() => void handleValidate()}
            onOpenMetadata={() => setMetadataDialogOpen(true)}
            onDownloadJson={() => void handleDownloadJson()}
            onImportJson={() => setImportJsonOpen(true)}
            onMapNodeSelect={id => scrollToStep(id)}
            validatePending={validateFlow.isPending}
            downloadPending={downloadingJson}
          />
        )}
      </Drawer>

      {globalIssues.length > 0 && (
        <Alert severity="warning" sx={{ mx: 2, mt: 1 }}>
          {globalIssues.map((g, i) => (
            <Typography key={i} variant="body2" component="div">
              {g.message}
            </Typography>
          ))}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <StepsIndex
          steps={vm.steps}
          activeStepId={activeStepId}
          onStepSelect={scrollToStep}
        />

        <Box
          component="main"
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: { xs: 1.5, sm: 2 },
            py: 2,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Editá los pasos y las respuestas. Usá Guardar cambios para validar y persistir en la base de datos.
            </Typography>
            <Button size="small" variant="contained" startIcon={<Add />} onClick={() => editor.addStep()}>
              Añadir paso
            </Button>
          </Box>

          {editor.validationIssues.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {buildConversationValidationSummary(vm, editor.validationIssues)}
            </Alert>
          )}

          {selectedStep && (
            <StepCard
              key={selectedStep.internalId}
              step={selectedStep}
              stepIndex={Math.max(selectedStepIndex, 0)}
              totalSteps={vm.steps.length}
              allSteps={vm.steps}
              validationIssues={editor.validationIssues}
              active={activeStepId === selectedStep.internalId}
              cardRef={el => registerStepRef(selectedStep.internalId, el)}
              onTitleChange={title => editor.updateStepTitle(selectedStep.internalId, title)}
              onMessageChange={message => editor.updateStepMessage(selectedStep.internalId, message)}
              onDuplicate={() => editor.duplicateStep(selectedStep.internalId)}
              onDelete={() => editor.deleteStep(selectedStep.internalId)}
              onMoveUp={() =>
                selectedStepIndex > 0 && editor.reorderSteps(selectedStepIndex, selectedStepIndex - 1)
              }
              onMoveDown={() =>
                selectedStepIndex >= 0 &&
                selectedStepIndex < vm.steps.length - 1 &&
                editor.reorderSteps(selectedStepIndex, selectedStepIndex + 1)
              }
              onAddResponse={kind => editor.addResponse(selectedStep.internalId, kind)}
              onUpdateResponseValues={(responseUiId, values) =>
                editor.updateResponse(selectedStep.internalId, responseUiId, { values })
              }
              onDeleteResponse={responseUiId =>
                editor.deleteResponse(selectedStep.internalId, responseUiId)
              }
              onSetResponseDestination={(responseUiId, targetId) =>
                editor.setResponseDestination(selectedStep.internalId, responseUiId, targetId)
              }
              onCreateStepForResponse={responseUiId =>
                editor.createStepAndAssignDestination(selectedStep.internalId, responseUiId)
              }
            />
          )}
        </Box>

        {isMdUp && draftFlowForSimulator && (
          <Box
            sx={{
              width: 360,
              flexShrink: 0,
              borderLeft: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              maxHeight: '100%',
            }}
          >
            <SimulatorPanel
              variant="panel"
              flowId={flowId!}
              draftFlow={draftFlowForSimulator}
              viewModel={vm}
              enabled={simulatorEnabled}
            />
          </Box>
        )}
      </Box>

      <Drawer anchor="left" open={indexDrawerOpen} onClose={() => setIndexDrawerOpen(false)}>
        <Box sx={{ width: 280, pt: 1 }}>
          <Typography variant="subtitle2" sx={{ px: 2, py: 1 }} fontWeight={700}>
            Pasos
          </Typography>
          {vm.steps.length > 6 && (
            <Box sx={{ px: 2, pb: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Buscar paso…"
                value={indexQuery}
                onChange={e => setIndexQuery(e.target.value)}
                aria-label="Buscar en el índice de pasos"
              />
            </Box>
          )}
          <List dense>
            {vm.steps
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => {
                const q = indexQuery.trim().toLowerCase();
                if (!q) return true;
                return s.title.toLowerCase().includes(q) || s.internalId.toLowerCase().includes(q);
              })
              .map(({ s, i }) => (
                <ListItemButton key={s.internalId} onClick={() => scrollToStep(s.internalId)}>
                  <ListItemText primary={s.title} secondary={`${i + 1}`} />
                </ListItemButton>
              ))}
          </List>
          {!isMdUp && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Button
                size="small"
                fullWidth
                variant="outlined"
                onClick={() => setSimulatorEnabled(v => !v)}
              >
                {simulatorEnabled ? 'Pausar simulador' : 'Activar simulador'}
              </Button>
            </Box>
          )}
        </Box>
      </Drawer>

      <FlowMetadataDialog
        open={metadataDialogOpen}
        initialName={vm.flowName}
        initialDescription={vm.description ?? ''}
        onClose={() => setMetadataDialogOpen(false)}
        onSave={(flowName, description) => editor.updateFlowInfo(flowName, description)}
      />
      <ImportJsonVersionDialog
        open={importJsonOpen}
        loadingValidate={validateImportFlow.isPending}
        loadingCreate={importJsonMutation.isPending}
        onClose={() => setImportJsonOpen(false)}
        onValidate={flow => validateImportFlow.mutateAsync(flow)}
        onCreate={async (flow, publish) => {
          const created = await importJsonMutation.mutateAsync({ flowId: flowId!, flow, publish });
          setImportJsonOpen(false);
          setSnackbar({
            open: true,
            message: `Nueva versión creada: ${created.version}.`,
            severity: 'success',
          });
          if (created.activated) {
            await queryClient.invalidateQueries({ queryKey: flowKeys.detail(flowId!) });
          }
        }}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={snackbar.severity === 'success' ? 4000 : 6000}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          setSnackbar(s => ({ ...s, open: false }));
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Dialog
        fullScreen
        open={simulatorOpen && !isMdUp}
        onClose={() => setSimulatorOpen(false)}
        PaperProps={{ sx: { display: 'flex', flexDirection: 'column', height: '100%' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', p: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
          <Button onClick={() => setSimulatorOpen(false)}>Listo</Button>
          <Typography sx={{ ml: 2 }} variant="subtitle1" fontWeight={700}>
            Probar conversación
          </Typography>
        </Box>
        {draftFlowForSimulator && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SimulatorPanel
              variant="modal"
              flowId={flowId!}
              draftFlow={draftFlowForSimulator}
              viewModel={vm}
            />
          </Box>
        )}
      </Dialog>

      <PublishReviewDialog
        open={publish.step === 'review'}
        loadingBaseline={publish.baselineLoading}
        changeSummary={publish.changeSummary}
        blockingWarnings={publish.blockingWarnings}
        nonBlockingWarnings={publish.nonBlockingWarnings}
        onClose={publish.closePublishFlow}
        onContinueNormal={publish.goConfirm}
        onContinueRisky={publish.goRisky}
      />
      <PublishConfirmDialog
        open={publish.step === 'confirm'}
        loading={publish.isPublishing}
        error={publish.publishError}
        onClose={publish.closePublishFlow}
        onConfirm={async () => {
          const ok = await publish.confirmPublish();
          if (ok) {
            setSnackbar({
              open: true,
              message: 'Listo. Los clientes ya ven esta versión.',
              severity: 'success',
            });
          }
        }}
      />
      <RiskyPublishDialog
        open={publish.step === 'risky'}
        loading={publish.isPublishing}
        error={publish.publishError}
        blockingWarnings={publish.blockingWarnings}
        onClose={publish.closePublishFlow}
        onConfirm={async () => {
          const ok = await publish.confirmRiskyPublish();
          if (ok) {
            setSnackbar({
              open: true,
              message: 'Listo. Los clientes ya ven esta versión.',
              severity: 'success',
            });
          }
        }}
      />
    </Box>
  );
};
