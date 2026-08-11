import { apiFetch, apiFetchPage, AUTH_TIMEOUT_MS, getAuthToken, projectArtifactUrl } from './client'
import type {
  ActionInfo,
  AdminUserDetail,
  AuthUser,
  BlogPost,
  BlogPostListItem,
  BugReport,
  BugReportSettings,
  ChatMessage,
  ChatMessageCreate,
  ChatSession,
  ChatSessionCreate,
  ChatSessionListItem,
  DefaultPlanInfo,
  ErrorEvent,
  ErrorTrackingSettings,
  FeatureRequest,
  FeatureRequestComment,
  FeatureRequestCommentCreate,
  FeatureRequestCreate,
  FeatureRequestListItem,
  FeatureRequestStatus,
  FeatureRequestUpdate,
  FeatureRequestVoteOut,
  MediaUploadResponse,
  ModelsResponse,
  MonitoringResponse,
  NavMenuItem,
  PlanInfo,
  ProjectDetail,
  ProjectSummary,
  SiteBrand,
  SurveyResponses,
  SurveySettings,
  Ticket,
  TicketCategory,
  TicketCreate,
  TicketListItem,
  TicketMessage,
  TicketMessageCreate,
  TicketPriority,
  TicketStatus,
  TicketUpdate,
  TokenResponse,
  TutorialVideo,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

function buildQuery(params?: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams()
  if (!params) return ''
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadAdminCsv(
  path: string,
  params?: Record<string, string | number | undefined | null>,
): Promise<Blob> {
  const token = getAuthToken()
  const suffix = buildQuery(params)
  const response = await fetch(`${API_BASE}${path}${suffix}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    throw new Error('Failed to download CSV')
  }
  return response.blob()
}

export const authApi = {
  login: (body: { email: string; password: string }) =>
    apiFetch<TokenResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  register: (body: { email: string; password: string }) =>
    apiFetch<TokenResponse>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  me: () => apiFetch<AuthUser>('/auth/me', {}, AUTH_TIMEOUT_MS),
  updateProfile: (body: {
    display_name?: string | null
    email?: string
    theme?: AuthUser['theme']
    current_password?: string
  }) =>
    apiFetch<AuthUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiFetch<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<AuthUser>('/auth/me/avatar', { method: 'POST', body: form })
  },
  removeAvatar: () => apiFetch<AuthUser>('/auth/me/avatar', { method: 'DELETE' }),
}

export const adminApi = {
  getMonitoring: () => apiFetch<MonitoringResponse>('/admin/monitoring'),
  listActions: () => apiFetch<ActionInfo[]>('/admin/actions'),
  listPlans: (params?: { active_only?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.active_only) query.set('active_only', 'true')
    const suffix = query.toString() ? `?${query}` : ''
    return apiFetch<PlanInfo[]>(`/admin/plans${suffix}`)
  },
  createPlan: (body: {
    name: string
    description?: string
    price?: number
    actions?: string[]
    models?: string[]
    is_active?: boolean
  }) =>
    apiFetch<PlanInfo>('/admin/plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePlan: (
    planId: number,
    body: {
      name?: string
      description?: string
      price?: number
      actions?: string[]
      models?: string[]
      is_active?: boolean
    },
  ) =>
    apiFetch<PlanInfo>(`/admin/plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deletePlan: (planId: number) =>
    apiFetch<void>(`/admin/plans/${planId}`, { method: 'DELETE' }),
  getDefaultPlan: () => apiFetch<DefaultPlanInfo>('/admin/settings/default-plan'),
  setDefaultPlan: (planId: number) =>
    apiFetch<DefaultPlanInfo>('/admin/settings/default-plan', {
      method: 'PUT',
      body: JSON.stringify({ plan_id: planId }),
    }),
  listUsers: () => apiFetch<AuthUser[]>('/admin/users'),
  getUser: (userId: number) => apiFetch<AdminUserDetail>(`/admin/users/${userId}`),
  createUser: (body: {
    email: string
    password: string
    is_admin?: boolean
    plan_id?: number | null
  }) =>
    apiFetch<AuthUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateUser: (
    userId: number,
    body: {
      is_active?: boolean
      is_admin?: boolean
      password?: string
      plan_id?: number | null
    },
  ) =>
    apiFetch<AuthUser>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listProjects: (params?: { user_id?: number; pipeline_type?: string }) => {
    const query = new URLSearchParams()
    if (params?.user_id != null) query.set('user_id', String(params.user_id))
    if (params?.pipeline_type) query.set('pipeline_type', params.pipeline_type)
    const suffix = query.toString() ? `?${query}` : ''
    return apiFetch<ProjectSummary[]>(`/admin/projects${suffix}`)
  },
  getProject: (projectId: number) =>
    apiFetch<ProjectDetail>(`/admin/projects/${projectId}`),
  downloadProjectArtifact: (projectId: number, filename: string) =>
    projectArtifactUrl(projectId, filename, 'admin'),
  updateProject: (
    projectId: number,
    body: { title?: string; status?: string },
  ) =>
    apiFetch<ProjectDetail>(`/admin/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (projectId: number) =>
    apiFetch<void>(`/admin/projects/${projectId}`, { method: 'DELETE' }),
  getErrorTrackingSettings: () =>
    apiFetch<ErrorTrackingSettings>('/admin/errors/settings'),
  updateErrorTrackingSettings: (body: Partial<ErrorTrackingSettings>) =>
    apiFetch<ErrorTrackingSettings>('/admin/errors/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listErrors: (params?: {
    user_id?: number
    source?: string
    status_code?: number
    q?: string
    limit?: number
  }) =>
    apiFetch<ErrorEvent[]>(
      `/admin/errors${buildQuery({
        user_id: params?.user_id,
        source: params?.source,
        status_code: params?.status_code,
        q: params?.q,
        limit: params?.limit,
      })}`,
    ),
  downloadErrorsCsv: (params?: {
    user_id?: number
    source?: string
    status_code?: number
    q?: string
    limit?: number
  }) =>
    downloadAdminCsv('/admin/errors/export.csv', {
      user_id: params?.user_id,
      source: params?.source,
      status_code: params?.status_code,
      q: params?.q,
      limit: params?.limit,
    }),
  downloadUsersCsv: () => downloadAdminCsv('/admin/users/export.csv'),
  downloadPlansCsv: () => downloadAdminCsv('/admin/plans/export.csv'),
  downloadProjectsCsv: (params?: { user_id?: number; pipeline_type?: string }) =>
    downloadAdminCsv('/admin/projects/export.csv', {
      user_id: params?.user_id,
      pipeline_type: params?.pipeline_type,
    }),
  downloadProjectsProfilingCsv: (params?: { user_id?: number; pipeline_type?: string }) =>
    downloadAdminCsv('/admin/projects/profiling/export.csv', {
      user_id: params?.user_id,
      pipeline_type: params?.pipeline_type,
    }),
  downloadMonitoringCsv: () => downloadAdminCsv('/admin/monitoring/export.csv'),
  downloadOverviewCsv: () => downloadAdminCsv('/admin/overview/export.csv'),
  downloadProfileSurveyCsv: () => downloadAdminCsv('/admin/survey/responses/profile/export.csv'),
  downloadFeedbackSurveyCsv: () => downloadAdminCsv('/admin/survey/responses/feedback/export.csv'),
  getSurveySettings: () => apiFetch<SurveySettings>('/admin/survey/settings'),
  updateSurveySettings: (body: Partial<SurveySettings>) =>
    apiFetch<SurveySettings>('/admin/survey/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listSurveyResponses: () => apiFetch<SurveyResponses>('/admin/survey/responses'),
  listTutorialVideos: () => apiFetch<TutorialVideo[]>('/admin/tutorial-videos'),
  uploadTutorialVideo: (title: string, file: File) => {
    const form = new FormData()
    form.append('title', title)
    form.append('file', file)
    return apiFetch<TutorialVideo>('/admin/tutorial-videos', {
      method: 'POST',
      body: form,
    })
  },
  updateTutorialVideo: (
    videoId: number,
    body: { title?: string; sort_order?: number },
  ) =>
    apiFetch<TutorialVideo>(`/admin/tutorial-videos/${videoId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteTutorialVideo: (videoId: number) =>
    apiFetch<void>(`/admin/tutorial-videos/${videoId}`, { method: 'DELETE' }),
}

export const healthApi = {
  check: () => apiFetch<{ status: string }>('/health'),
  models: () => apiFetch<ModelsResponse>('/models'),
}

export const bugReportsApi = {
  status: () => apiFetch<BugReportSettings>('/bug-reports/status'),
  create: (body: { description: string; page_url?: string; image?: File | null }) => {
    const form = new FormData()
    form.append('description', body.description)
    if (body.page_url) form.append('page_url', body.page_url)
    if (body.image) form.append('image', body.image)
    return apiFetch<BugReport>('/bug-reports', { method: 'POST', body: form })
  },
  getSettings: () => apiFetch<BugReportSettings>('/admin/bug-reports/settings'),
  updateSettings: (body: Partial<BugReportSettings>) =>
    apiFetch<BugReportSettings>('/admin/bug-reports/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listAdmin: (params?: { status?: 'open' | 'fixed' | 'all' }) =>
    apiFetch<BugReport[]>(
      `/admin/bug-reports${buildQuery({ status: params?.status })}`,
    ),
  getAdmin: (reportId: number) => apiFetch<BugReport>(`/admin/bug-reports/${reportId}`),
  updateStatus: (reportId: number, status: 'open' | 'fixed') =>
    apiFetch<BugReport>(`/admin/bug-reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  downloadCsv: (params?: { status?: 'open' | 'fixed' | 'all' }) =>
    downloadAdminCsv('/admin/bug-reports/export.csv', {
      status: params?.status,
    }),
}

export const adminSiteApi = {
  getBrand: () => apiFetch<SiteBrand>('/admin/site/brand'),
  updateBrand: (body: SiteBrand) =>
    apiFetch<SiteBrand>('/admin/site/brand', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getLanding: () => apiFetch<Record<string, unknown>>('/admin/site/landing'),
  updateLanding: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/admin/site/landing', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listMenus: (location?: string) =>
    apiFetch<NavMenuItem[]>(`/admin/site/menus${buildQuery({ location })}`),
  createMenu: (body: Omit<NavMenuItem, 'id'>) =>
    apiFetch<NavMenuItem>('/admin/site/menus', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMenu: (menuId: number, body: Partial<Omit<NavMenuItem, 'id'>>) =>
    apiFetch<NavMenuItem>(`/admin/site/menus/${menuId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteMenu: (menuId: number) =>
    apiFetch<void>(`/admin/site/menus/${menuId}`, { method: 'DELETE' }),
}

export const adminMediaApi = {
  upload: (file: File, prefix = 'image') => {
    const form = new FormData()
    form.append('file', file)
    form.append('prefix', prefix)
    return apiFetch<MediaUploadResponse>('/admin/media', { method: 'POST', body: form })
  },
}

export const adminBlogApi = {
  list: () => apiFetch<BlogPostListItem[]>('/admin/blog'),
  get: (postId: number) => apiFetch<BlogPost>(`/admin/blog/${postId}`),
  create: (body: {
    title: string
    slug?: string | null
    excerpt?: string
    body_markdown?: string
    cover_image_url?: string | null
    status?: string
  }) =>
    apiFetch<BlogPost>('/admin/blog', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (
    postId: number,
    body: {
      title?: string
      slug?: string
      excerpt?: string
      body_markdown?: string
      cover_image_url?: string | null
      status?: string
    },
  ) =>
    apiFetch<BlogPost>(`/admin/blog/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  delete: (postId: number) =>
    apiFetch<void>(`/admin/blog/${postId}`, { method: 'DELETE' }),
}

export const chatsApi = {
  create: (body?: ChatSessionCreate) =>
    apiFetch<ChatSession>('/chats', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  list: (params?: { status?: 'open' | 'active' | 'closed' | 'all' }) =>
    apiFetch<ChatSessionListItem[]>(
      `/chats${buildQuery({ status: params?.status })}`,
    ),
  get: (chatId: number) => apiFetch<ChatSession>(`/chats/${chatId}`),
  join: (chatId: number) =>
    apiFetch<ChatSession>(`/chats/${chatId}/join`, { method: 'POST' }),
  close: (chatId: number) =>
    apiFetch<ChatSession>(`/chats/${chatId}/close`, { method: 'PATCH' }),
  listMessages: (chatId: number) =>
    apiFetch<ChatMessage[]>(`/chats/${chatId}/messages`),
  sendMessage: (chatId: number, body: ChatMessageCreate) =>
    apiFetch<ChatMessage>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const featureRequestsApi = {
  create: (body: FeatureRequestCreate) =>
    apiFetch<FeatureRequest>('/feature-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  list: (params?: { status?: FeatureRequestStatus | 'all' }) =>
    apiFetch<FeatureRequestListItem[]>(
      `/feature-requests${buildQuery({ status: params?.status })}`,
    ),
  get: (requestId: number) =>
    apiFetch<FeatureRequest>(`/feature-requests/${requestId}`),
  update: (requestId: number, body: FeatureRequestUpdate) =>
    apiFetch<FeatureRequest>(`/feature-requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateStatus: (requestId: number, status: FeatureRequestStatus) =>
    apiFetch<FeatureRequest>(`/admin/feature-requests/${requestId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  remove: (requestId: number) =>
    apiFetch<void>(`/feature-requests/${requestId}`, { method: 'DELETE' }),
  vote: (requestId: number) =>
    apiFetch<FeatureRequestVoteOut>(`/feature-requests/${requestId}/vote`, {
      method: 'POST',
    }),
  unvote: (requestId: number) =>
    apiFetch<void>(`/feature-requests/${requestId}/vote`, { method: 'DELETE' }),
  listComments: (requestId: number) =>
    apiFetch<FeatureRequestComment[]>(`/feature-requests/${requestId}/comments`),
  addComment: (requestId: number, body: FeatureRequestCommentCreate) =>
    apiFetch<FeatureRequestComment>(`/feature-requests/${requestId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const ticketsApi = {
  create: (body: TicketCreate) =>
    apiFetch<Ticket>('/tickets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  list: (params?: {
    status?: TicketStatus | 'all'
    priority?: TicketPriority | 'all'
    category?: TicketCategory | 'all'
    // Both optional — omit to get every matching ticket (previous
    // behavior). The API also returns the total match count in the
    // `X-Total-Count` response header for callers that add paging UI.
    page?: number
    pageSize?: number
  }) =>
    apiFetch<TicketListItem[]>(
      `/tickets${buildQuery({
        status: params?.status,
        priority: params?.priority,
        category: params?.category,
        page: params?.page,
        page_size: params?.pageSize,
      })}`,
    ),
  /** Server-paginated ticket list: fetches one page and its total count. */
  listPage: (params: {
    status?: TicketStatus | 'all'
    priority?: TicketPriority | 'all'
    category?: TicketCategory | 'all'
    page: number
    pageSize: number
  }) =>
    apiFetchPage<TicketListItem[]>(
      `/tickets${buildQuery({
        status: params.status,
        priority: params.priority,
        category: params.category,
        page: params.page,
        page_size: params.pageSize,
      })}`,
    ),
  get: (ticketId: number) => apiFetch<Ticket>(`/tickets/${ticketId}`),
  update: (ticketId: number, body: TicketUpdate) =>
    apiFetch<Ticket>(`/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateStatus: (ticketId: number, status: TicketStatus) =>
    apiFetch<Ticket>(`/tickets/${ticketId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  assign: (ticketId: number, assignedTo: number | null) =>
    apiFetch<Ticket>(`/tickets/${ticketId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo }),
    }),
  close: (ticketId: number) =>
    apiFetch<Ticket>(`/tickets/${ticketId}/close`, { method: 'PATCH' }),
  remove: (ticketId: number) =>
    apiFetch<void>(`/tickets/${ticketId}`, { method: 'DELETE' }),
  getMessages: (ticketId: number) =>
    apiFetch<TicketMessage[]>(`/tickets/${ticketId}/messages`),
  addMessage: (ticketId: number, body: TicketMessageCreate) =>
    apiFetch<TicketMessage>(`/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
