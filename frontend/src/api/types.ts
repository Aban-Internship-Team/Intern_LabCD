export interface MediaUploadResponse {
  url: string
}

export interface ModelsResponse {
  llm_models: string[]
  rag_models: string[]
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AuthUser {
  id: number
  email: string
  display_name: string | null
  avatar_url: string | null
  theme: ThemeMode
  is_admin: boolean
  is_active: boolean
  plan_id: number | null
  plan_name: string | null
  actions: string[]
  created_at: string
  profile_survey_completed?: boolean
  feedback_survey_completed?: boolean
  feedback_survey_completed_silo?: boolean
  feedback_survey_completed_mulo?: boolean
  tutorial_dont_show_again?: boolean
}

export interface UserProfileSurveyDetail {
  university: string | null
  degree: string | null
  major: string | null
  matlab_experience: string | null
  control_design_experience: string | null
  completed_at: string | null
}

export type FeedbackPipelineType = 'siloDesign' | 'muloDesign'

export interface UserFeedbackSurveyDetail {
  pipeline_type: FeedbackPipelineType
  satisfaction: number
  ease_of_use: number
  product_value: number
  confidence: number
  reuse_intention: number
  willingness_to_pay: number
  main_problems: string
  created_at: string
}

export interface AdminUserDetail {
  user: AuthUser
  allowed_models: string[]
  profile_survey: UserProfileSurveyDetail | null
  feedback_surveys: UserFeedbackSurveyDetail[]
  projects: ProjectSummary[]
  errors: ErrorEvent[]
}

export interface SurveySettings {
  enabled: boolean
}

export interface TutorialVideo {
  id: number
  title: string
  file_url: string
  sort_order: number
  created_at: string
}

export interface ProfileSurveyResponseRow {
  user_id: number
  email: string
  university: string | null
  degree: string | null
  major: string | null
  matlab_experience: string | null
  control_design_experience: string | null
  completed_at: string | null
}

export interface FeedbackSurveyResponseRow {
  user_id: number
  email: string
  pipeline_type: FeedbackPipelineType
  satisfaction: number
  ease_of_use: number
  product_value: number
  confidence: number
  reuse_intention: number
  willingness_to_pay: number
  main_problems: string
  created_at: string
}

export interface SurveyResponses {
  profile: ProfileSurveyResponseRow[]
  feedback: FeedbackSurveyResponseRow[]
}

export interface ActionInfo {
  code: string
  description: string
}

export interface PlanInfo {
  id: number
  name: string
  description: string
  price: number
  is_active: boolean
  actions: string[]
  models: string[]
  created_at: string
}

export interface DefaultPlanInfo {
  plan_id: number | null
  plan: PlanInfo | null
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export type ProjectPipelineType = 'siloDesign' | 'muloDesign'
export type ProjectStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ProjectSummary {
  id: number
  user_id: number
  owner_email?: string | null
  title: string
  pipeline_type: ProjectPipelineType
  status: ProjectStatus
  file_name: string
  file_type: string
  file_url?: string | null
  llm_model: string
  has_results: boolean
  job_id?: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDetail extends ProjectSummary {
  file_content: string
  control_objective?: string | null
  results?: Record<string, unknown> | null
}

export interface MemoryMetrics {
  used_bytes: number
  total_bytes: number
  percent: number
}

export interface DiskMetrics {
  used_bytes: number
  total_bytes: number
  percent: number
}

export interface NetworkMetrics {
  bytes_sent: number
  bytes_recv: number
  sent_rate_bps: number
  recv_rate_bps: number
}

export interface ApiMetrics {
  avg_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  error_rate_percent: number
  requests_in_window: number
}

export interface MonitoringSnapshot {
  collected_at: string
  uptime_seconds: number
  cpu_percent: number
  memory: MemoryMetrics
  disk: DiskMetrics
  network: NetworkMetrics
  api: ApiMetrics
}

export interface MonitoringResponse {
  current: MonitoringSnapshot
  history: MonitoringSnapshot[]
}

export interface ErrorTrackingSettings {
  enabled: boolean
  frontend: boolean
  backend: boolean
  api: boolean
}

export type ErrorEventSource = 'frontend' | 'backend' | 'api'

export interface ErrorEvent {
  id: number
  source: ErrorEventSource | string
  message: string
  stack_trace: string | null
  path: string | null
  method: string | null
  status_code: number | null
  user_id: number | null
  user_agent: string | null
  page_url: string | null
  extra: Record<string, unknown> | null
  created_at: string | null
}

export interface SiteBrand {
  brand_name: string
  tagline: string
  logo_url: string
  primary_color: string
  secondary_color: string
  sign_in_url: string
  access_platform_url: string
  page_title: string
}

export interface NavMenuItem {
  id: number
  location: string
  label: string
  href: string
  sort_order: number
  is_external: boolean
}

export interface BlogPostListItem {
  id: number
  title: string
  slug: string
  excerpt: string
  cover_image_url: string | null
  status: string
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface BlogPost extends BlogPostListItem {
  body_markdown: string
  author_id: number | null
}

export type BugReportStatus = 'open' | 'fixed'

export interface BugReport {
  id: number
  user_id: number | null
  user_email: string | null
  description: string
  image_url: string | null
  page_url: string | null
  status: BugReportStatus | string
  created_at: string
  fixed_at: string | null
}

export interface BugReportSettings {
  enabled: boolean
}

// --- Live Chat ---

export type ChatSessionStatus = 'open' | 'active' | 'closed'

export interface ChatMessage {
  id: number
  chat_session_id: number
  sender_id: number
  sender_email: string | null
  message: string
  created_at: string
}

export interface ChatSession {
  id: number
  user_id: number
  user_email: string | null
  agent_id: number | null
  agent_email: string | null
  status: ChatSessionStatus | string
  created_at: string
  closed_at: string | null
  messages?: ChatMessage[]
}

export interface ChatSessionListItem {
  id: number
  user_id: number
  user_email: string | null
  agent_id: number | null
  agent_email: string | null
  status: ChatSessionStatus | string
  created_at: string
  closed_at: string | null
}

export interface ChatSessionCreate {
  message?: string | null
}

export interface ChatMessageCreate {
  message: string
}

// --- Feature Requests ---

export type FeatureRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'rejected'

export interface FeatureRequestComment {
  id: number
  feature_request_id: number
  user_id: number
  user_email: string | null
  comment: string
  created_at: string
}

export interface FeatureRequest {
  id: number
  user_id: number
  user_email: string | null
  title: string
  description: string
  status: FeatureRequestStatus | string
  vote_count: number
  created_at: string
  updated_at: string
  has_voted?: boolean
  comments?: FeatureRequestComment[]
}

export interface FeatureRequestListItem {
  id: number
  user_id: number
  user_email: string | null
  title: string
  description: string
  status: FeatureRequestStatus | string
  vote_count: number
  created_at: string
  updated_at: string
  has_voted?: boolean
}

export interface FeatureRequestCreate {
  title: string
  description: string
}

export interface FeatureRequestUpdate {
  title?: string
  description?: string
  status?: FeatureRequestStatus
}

export interface FeatureRequestCommentCreate {
  comment: string
}

export interface FeatureRequestVoteOut {
  id: number
  feature_request_id: number
  user_id: number
  created_at: string
  vote_count: number
}
