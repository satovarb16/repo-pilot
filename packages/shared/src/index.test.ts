import { describe, it, expect } from 'vitest';
import {
  AgentRunStatus,
  CloneStatus,
  ApprovalStatus,
  ApprovalType,
  FileChangeType,
  TestRunStatus,
  ToolPermissionLevel,
  isAgentRunStatus,
  isCloneStatus,
  isApprovalStatus,
} from './index.js';

describe('AgentRunStatus', () => {
  it('has all state machine states as string values', () => {
    expect(AgentRunStatus.IDLE).toBe('idle');
    expect(AgentRunStatus.ANALYZING_REPO).toBe('analyzing_repo');
    expect(AgentRunStatus.PLANNING).toBe('planning');
    expect(AgentRunStatus.WAITING_FOR_PLAN_APPROVAL).toBe('waiting_for_plan_approval');
    expect(AgentRunStatus.EDITING).toBe('editing');
    expect(AgentRunStatus.WAITING_FOR_EDIT_APPROVAL).toBe('waiting_for_edit_approval');
    expect(AgentRunStatus.WAITING_FOR_TEST_RUN_APPROVAL).toBe('waiting_for_test_run_approval');
    expect(AgentRunStatus.RUNNING_TESTS).toBe('running_tests');
    expect(AgentRunStatus.REVIEWING).toBe('reviewing');
    expect(AgentRunStatus.WAITING_FOR_PR_APPROVAL).toBe('waiting_for_pr_approval');
    expect(AgentRunStatus.OPENING_PR).toBe('opening_pr');
    expect(AgentRunStatus.REPAIRING).toBe('repairing');
    expect(AgentRunStatus.COMPLETE).toBe('complete');
    expect(AgentRunStatus.FAILED).toBe('failed');
  });
});

describe('CloneStatus', () => {
  it('has pending, cloning, ready, and failed values', () => {
    expect(CloneStatus.PENDING).toBe('pending');
    expect(CloneStatus.CLONING).toBe('cloning');
    expect(CloneStatus.READY).toBe('ready');
    expect(CloneStatus.FAILED).toBe('failed');
  });
});

describe('ApprovalStatus', () => {
  it('has pending, approved, and rejected values', () => {
    expect(ApprovalStatus.PENDING).toBe('pending');
    expect(ApprovalStatus.APPROVED).toBe('approved');
    expect(ApprovalStatus.REJECTED).toBe('rejected');
  });
});

describe('ApprovalType', () => {
  it('has plan, edit, test_run, and pr values', () => {
    expect(ApprovalType.PLAN).toBe('plan');
    expect(ApprovalType.EDIT).toBe('edit');
    expect(ApprovalType.TEST_RUN).toBe('test_run');
    expect(ApprovalType.PR).toBe('pr');
  });
});

describe('FileChangeType', () => {
  it('has create, update, and delete values', () => {
    expect(FileChangeType.CREATE).toBe('create');
    expect(FileChangeType.UPDATE).toBe('update');
    expect(FileChangeType.DELETE).toBe('delete');
  });
});

describe('TestRunStatus', () => {
  it('has running, passed, and failed values', () => {
    expect(TestRunStatus.RUNNING).toBe('running');
    expect(TestRunStatus.PASSED).toBe('passed');
    expect(TestRunStatus.FAILED).toBe('failed');
  });
});

describe('ToolPermissionLevel', () => {
  it('has read, write, and destructive values', () => {
    expect(ToolPermissionLevel.READ).toBe('read');
    expect(ToolPermissionLevel.WRITE).toBe('write');
    expect(ToolPermissionLevel.DESTRUCTIVE).toBe('destructive');
  });
});

describe('isAgentRunStatus', () => {
  it('returns true for any valid status', () => {
    expect(isAgentRunStatus('idle')).toBe(true);
    expect(isAgentRunStatus('complete')).toBe(true);
    expect(isAgentRunStatus('failed')).toBe(true);
    expect(isAgentRunStatus('repairing')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isAgentRunStatus('unknown')).toBe(false);
    expect(isAgentRunStatus('')).toBe(false);
    expect(isAgentRunStatus('IDLE')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isAgentRunStatus(null)).toBe(false);
    expect(isAgentRunStatus(undefined)).toBe(false);
    expect(isAgentRunStatus(42)).toBe(false);
  });
});

describe('isCloneStatus', () => {
  it('returns true for valid clone status', () => {
    expect(isCloneStatus('pending')).toBe(true);
    expect(isCloneStatus('ready')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isCloneStatus('done')).toBe(false);
    expect(isCloneStatus(null)).toBe(false);
  });
});

describe('isApprovalStatus', () => {
  it('returns true for valid approval status', () => {
    expect(isApprovalStatus('pending')).toBe(true);
    expect(isApprovalStatus('approved')).toBe(true);
    expect(isApprovalStatus('rejected')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isApprovalStatus('denied')).toBe(false);
    expect(isApprovalStatus(null)).toBe(false);
  });
});
