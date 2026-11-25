# CR2-431-05 / 06

- Skips: `patchRetentionJobAttemptSkip` (no altera `last_status` / `activeRunId` del propietario).
- Terminales: `upsertJobStatusRetentionOwner` con fence `ownerRunId`.
- Media: conteo uncertain / hydrate failure → `PARTIAL` o `job_finished_with_media_cleanup_pending`.