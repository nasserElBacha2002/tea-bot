/**
 * Decide si el servidor puede reemplazar el estado local del editor.
 * No pisar ediciones locales en refetch del mismo flujo cuando hay cambios sin guardar.
 */
export function shouldApplyServerHydration(args: {
  incomingFlowId: string;
  lastHydratedFlowId: string | null;
  editorDirty: boolean;
}): boolean {
  if (args.lastHydratedFlowId !== args.incomingFlowId) return true;
  return !args.editorDirty;
}
