// oxlint-disable-next-line no-restricted-imports -- Capture the SSE callback contract without making requests.
import type { IOtherOptions } from '@/service/base'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import { createNode, createNodeTracing } from '../../../__tests__/fixtures'
import {
  renderWorkflowFlowHook as renderHook,
  renderWorkflowComponent,
} from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import { useChat } from '../hooks'

const mockHandleRun = vi.hoisted(() => vi.fn())
const mockFetchInspectVars = vi.hoisted(() => vi.fn())
const mockInvalidAllLastRun = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputForm = vi.hoisted(() => vi.fn())
const mockSseGet = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: (...args: unknown[]) => mockSseGet(...args),
  request: mockRequest,
}))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
}

describe('useChat', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('keeps workflow-tool tracing available after resuming a sibling with pending human input', async () => {
    const user = userEvent.setup()
    let sendCallbacks: IOtherOptions
    let resumeCallbacks: IOtherOptions
    mockHandleRun.mockImplementation((_params: unknown, callbacks: IOtherOptions) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation((_url: unknown, _options: unknown, callbacks: IOtherOptions) => {
      resumeCallbacks = callbacks
    })
    mockRequest.mockImplementation(() => Promise.resolve(Response.json({ data: [] })))
    const envelope = { task_id: 'task-1', workflow_run_id: 'workflow-run-1' }
    const started = {
      ...envelope,
      event: 'workflow_started',
      message_id: 'message-1',
      data: { id: 'workflow-run-1', workflow_id: 'workflow-1', created_at: 1 },
    }
    const tool = createNodeTracing({
      id: 'tool-execution',
      node_id: 'tool-node',
      node_type: BlockEnum.Tool,
      title: 'Downstream workflow tool',
    })
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    })

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })
    act(() => {
      sendCallbacks.onWorkflowStarted!(started)
      sendCallbacks.onHumanInputRequired!({
        ...envelope,
        event: 'human_input_required',
        data: {
          form_id: 'form-1',
          node_id: 'human-node',
          node_title: 'Human approval',
          form_content: 'Approve this workflow?',
          form_token: 'form-token',
          inputs: [],
          actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
          resolved_default_values: {},
          display_in_ui: true,
          expiration_time: null,
        },
      })
      sendCallbacks.onWorkflowPaused!({
        ...envelope,
        event: 'workflow_paused',
        data: {
          workflow_run_id: envelope.workflow_run_id,
          paused_nodes: ['human-node'],
          reasons: [],
          outputs: {},
        },
      })
    })
    await act(async () => {
      await sendCallbacks.onCompleted!(false)
    })
    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })
    act(() => {
      sendCallbacks.onWorkflowStarted!({
        ...started,
        workflow_run_id: 'workflow-run-2',
        task_id: 'task-2',
        message_id: 'message-2',
        data: { ...started.data, id: 'workflow-run-2' },
      })
    })
    await act(async () => {
      await sendCallbacks.onCompleted!(false)
    })
    act(() => {
      result.current.handleSwitchSibling('message-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/workflow-run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ onCompleted: expect.any(Function), onData: expect.any(Function) }),
    )
    act(() => {
      resumeCallbacks.onWorkflowStarted!(started)
      resumeCallbacks.onHumanInputFormFilled!({
        ...envelope,
        event: 'human_input_form_filled',
        data: {
          form_id: 'form-1',
          node_id: 'human-node',
          node_title: 'Human approval',
          rendered_content: 'Approve this workflow?',
          action_id: 'approve',
          action_text: 'Approve',
        },
      })
      resumeCallbacks.onNodeStarted!({
        ...envelope,
        event: 'node_started',
        data: {
          ...tool,
          extras: { workflow_tool: true, icon: { content: '✅', background: '#fff' } },
        },
      })
      resumeCallbacks.onNodeFinished!({
        ...envelope,
        event: 'node_finished',
        data: { ...tool, status: 'succeeded', elapsed_time: 1, finished_at: 2 },
      })
      resumeCallbacks.onWorkflowFinished!({
        ...envelope,
        event: 'workflow_finished',
        data: {
          ...started.data,
          status: 'succeeded',
          outputs: {},
          error: '',
          elapsed_time: 1,
          total_tokens: 0,
          total_steps: 2,
          created_by: tool.created_by,
          finished_at: 2,
        },
      })
    })
    await act(async () => {
      await resumeCallbacks.onCompleted!(false)
    })

    const answer = result.current.chatList.find((item) => item.id === 'message-1')!
    renderWorkflowComponent(
      <WorkflowProcessItem item={answer} data={answer.workflowProcess!} expand />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' } },
    )
    expect(
      screen.getByRole('img', { name: 'workflow.common.workflowProcessSucceeded' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Downstream workflow tool/ }))
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(await screen.findByText('common.noData')).toBeVisible()
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining(
        '/apps/app-1/workflow-runs/workflow-run-1/node-executions/tool-execution/children',
      ),
      expect.anything(),
      expect.anything(),
    )
  })

  it('submits human input forms through the workflow service', async () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', {
        inputs: { field: 'value' },
        action: 'approve',
      })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', {
      inputs: { field: 'value' },
      action: 'approve',
    })
  })

  it('returns the matching custom node for a human input request', () => {
    const node = createNode({
      id: 'node-1',
      data: { type: BlockEnum.HumanInput, title: 'Human Input' },
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      nodes: [node, createNode({ id: 'node-2' })],
    })

    expect(result.current.getHumanInputNodeData('node-1')).toMatchObject(node)
    expect(result.current.getHumanInputNodeData('missing')).toBeUndefined()
  })
})
