# CR2-431-01

- Una única llamada async a `resolveActiveConversation`.
- Tras await: si cambió `updatedAt` y hay nuevo `conversationId` → `skipped_bound_to_other_conversation`; si cambió sin vínculo → `skipped_concurrent_mutation`.
- Entre comprobación final y borrado: solo operaciones síncronas (`delete` + `saveSessions`).
- Tests: barrera en resolve, mutación post-bind, rebind generacional.