// ----- SSE Event Types -----
// Single authoritative definition. Both backend (agent-core) and frontend (web) import from here.

export type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'approval_required'; approvalType: 'plan'; planText: string }
  | { type: 'approval_required'; approvalType: 'test_run'; command: string }
  | { type: 'approval_required'; approvalType: 'pr'; prTitle: string; prBody: string }
  | { type: 'edit_proposed'; changeId: string; filePath: string; diff: string; originalContent: string; proposedContent: string }
  | { type: 'test_run_started'; command: string }
  | { type: 'test_run_completed'; testRunId: string; status: string; exitCode: number; durationMs: number; sandboxed: boolean; stdout: string; stderr: string }
  | { type: 'repair_started'; attempt: number; maxAttempts: number }
  | { type: 'repair_completed'; runId: string; attempt: number; success: boolean }
  | { type: 'test_output_chunk'; runId: string; chunk: string }
  | { type: 'run_completed'; planJson: unknown; prUrl?: string }
  | { type: 'run_failed'; error: string }
  | { type: 'pr_opened'; prUrl: string; prNumber: number }
  | { type: 'run_cancelled' }

// ----- Enums -----

export const AgentRunStatus = {
  IDLE: 'idle',
  ANALYZING_REPO: 'analyzing_repo',
  PLANNING: 'planning',
  WAITING_FOR_PLAN_APPROVAL: 'waiting_for_plan_approval',
  EDITING: 'editing',
  WAITING_FOR_EDIT_APPROVAL: 'waiting_for_edit_approval',
  WAITING_FOR_TEST_RUN_APPROVAL: 'waiting_for_test_run_approval',
  RUNNING_TESTS: 'running_tests',
  REVIEWING: 'reviewing',
  WAITING_FOR_PR_APPROVAL: 'waiting_for_pr_approval',
  OPENING_PR: 'opening_pr',
  REPAIRING: 'repairing',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

export const CloneStatus = {
  PENDING: 'pending',
  CLONING: 'cloning',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type CloneStatus = (typeof CloneStatus)[keyof typeof CloneStatus];

export const ApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalType = {
  PLAN: 'plan',
  EDIT: 'edit',
  TEST_RUN: 'test_run',
  PR: 'pr',
} as const;

export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export const FileChangeType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;

export type FileChangeType = (typeof FileChangeType)[keyof typeof FileChangeType];

export const TestRunStatus = {
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
} as const;

export type TestRunStatus = (typeof TestRunStatus)[keyof typeof TestRunStatus];

export const ToolPermissionLevel = {
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive',
} as const;

export type ToolPermissionLevel = (typeof ToolPermissionLevel)[keyof typeof ToolPermissionLevel];

// ----- Type guards -----

const agentRunStatusValues = new Set<string>(Object.values(AgentRunStatus));
const cloneStatusValues = new Set<string>(Object.values(CloneStatus));
const approvalStatusValues = new Set<string>(Object.values(ApprovalStatus));

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && agentRunStatusValues.has(value);
}

export function isCloneStatus(value: unknown): value is CloneStatus {
  return typeof value === 'string' && cloneStatusValues.has(value);
}

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && approvalStatusValues.has(value);
}

// ----- Domain types -----

export interface Repository {
  id: string;
  userId: string;
  githubRepoId: number;
  owner: string;
  name: string;
  cloneUrl: string;
  localClonePath: string | null;
  cloneStatus: CloneStatus;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

export interface AgentRun {
  id: string;
  userId: string;
  repoId: string;
  taskDescription: string;
  status: string;
  currentState: AgentRunStatus;
  branchName: string | null;
  planJson: unknown | null;
  summaryText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentStep {
  id: string;
  runId: string;
  stepNumber: number;
  stepType: string;
  description: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface FileChange {
  id: string;
  runId: string;
  filePath: string;
  changeType: FileChangeType;
  originalContent: string | null;
  proposedContent: string | null;
  diffContent: string | null;
  approved: boolean | null;
  writtenAt: Date | null;
  createdAt: Date;
}

export interface Approval {
  id: string;
  runId: string;
  approvalType: ApprovalType;
  filePath: string | null;
  status: ApprovalStatus;
  feedback: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  runId: string;
  stepId: string | null;
  toolName: string;
  inputJson: unknown;
  outputJson: unknown | null;
  permissionLevel: ToolPermissionLevel;
  approved: boolean | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface TestRun {
  id: string;
  runId: string;
  command: string;
  status: TestRunStatus;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
  dockerImage: string | null;
  createdAt: Date;
}

export interface PullRequest {
  id: string;
  runId: string;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
  title: string;
  body: string;
  branchName: string;
  status: string;
  createdAt: Date;
}
