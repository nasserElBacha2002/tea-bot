import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRetentionJobView,
  noteRetentionSignal,
  resetJobStatusForTests,
} from './job-status.store.js';

test.beforeEach(() => {
  resetJobStatusForTests();
});

test('skip distribuido no pisa último éxito', () => {
  noteRetentionSignal('job_started', { runId: 'run-1' });
  noteRetentionSignal('job_finished', { conversations_deleted: 2, duration: 10 });
  const afterSuccess = getRetentionJobView();
  noteRetentionSignal('job_skipped_distributed_lock', { runId: 'run-2' });
  const view = getRetentionJobView();
  assert.equal(view.lastSuccessfulFinishedAt, afterSuccess.lastSuccessfulFinishedAt);
  assert.equal(view.lastSkipReason, 'distributed_lock');
  assert.equal(view.lastDeletedCount, 2);
  assert.equal(view.lastStatus, 'SUCCESS');
  assert.equal(view.activeRunId, null);
});

test('job_stopped_shutdown no deja estado SUCCESS', () => {
  noteRetentionSignal('job_started', { runId: 'run-shutdown' });
  noteRetentionSignal('job_stopped_shutdown', { conversations_deleted: 3, duration: 50 });
  const view = getRetentionJobView();
  assert.equal(view.lastStatus, 'SHUTDOWN');
  assert.equal(view.activeRunId, null);
  assert.equal(view.lastDeletedCount, 3);
});

test('skip distribuido sin job_started no marca RUNNING', () => {
  noteRetentionSignal('job_finished', { conversations_deleted: 1, duration: 5 });
  noteRetentionSignal('job_skipped_distributed_lock', { runId: 'run-skip' });
  const view = getRetentionJobView();
  assert.equal(view.lastStatus, 'SUCCESS');
  assert.equal(view.activeRunId, null);
});