export type RoleMode = 'agent' | 'tutor' | 'teach';
export type TutorSubTab = 'solve' | 'mindmap' | 'errorbook' | 'plan';
export type TeachTab = 'lesson' | 'ppt' | 'exam' | 'analytics';

export interface CriticalPointPin {
  x: number;
  y: number;
  kind: 'max' | 'min' | 'inflection' | 'stationary';
  kind_cn: string;
  label: string;
}

export interface FunctionPlotData {
  ok: boolean;
  error?: string;
  expression: string;
  expr_latex: string;
  deriv_latex: string;
  x_domain: [number, number];
  y_domain: [number, number];
  f_segments: [number, number][][];
  df_segments: [number, number][][];
  critical_points: CriticalPointPin[];
  curve_samples: { x: number; y: number; dy: number }[];
}

export interface LLMStatusSummary {
  protocol: string;
  base_url_host: string;
  model: string;
  has_api_key: boolean;
  key_source: string;
  max_tokens: number;
}

export interface TelemetrySummary {
  total_artifacts: number;
  total_runs: number;
  verification_pass_rate: number;
  human_revision_rate: number;
  avg_generation_sec: number;
  counts: {
    error_book: number;
    lessons: number;
    ppt_decks: number;
    exams: number;
    analytics: number;
  };
  runs_by_module: Record<string, number>;
}

export interface ArtifactItem {
  id: string;
  title: string;
  category: string;
  module: string;
  filename: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  verified_status: string;
  revision_count: number;
  download_url: string;
  created_at: number;
  updated_at: number;
  meta: Record<string, unknown>;
}

export interface SympyCheckResult {
  label: string;
  type: string;
  passed: boolean;
  detail: string;
}

export interface VerificationReport {
  status: 'verified' | 'needs_review' | 'mismatch';
  badge: string;
  passed?: number;
  total?: number;
  checks?: SympyCheckResult[];
}

export interface TutorSolution {
  topic_tag: string;
  known_conditions: string[];
  missing_condition_check: {
    has_ambiguity: boolean;
    prompt: string;
  };
  hints: { level: number; title: string; content: string }[];
  steps: { step: number; title: string; derivation: string; theorem_basis: string }[];
  final_answer: string;
  uncertainty_note: string;
  knowledge_graph: {
    prerequisites: string[];
    core_concept: string;
    common_traps: string[];
    extensions: string[];
    interdisciplinary_bridges?: string[];
  };
  evidence_checks?: { label: string; detail: string }[];
  variants: {
    tier: string;
    question: string;
    options?: string[];
    answer: string;
    explanation: string;
  }[];
  teaching_bridge?: {
    suggested_lesson_title: string;
    pedagogical_focus: string;
  };
  draft_diagnosis?: {
    has_attempt: boolean;
    summary: string;
  };
}

export interface TutorFollowupMsg {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export interface AgentPlanStep {
  tool: string;
  step_label: string;
  args: Record<string, unknown>;
}

export interface AgentToolTrace {
  index: number;
  tool: string;
  label: string;
  ok: boolean;
  summary: string;
  auto_repaired?: boolean;
}

export interface AgentLinkedItem {
  kind: 'mindmap' | 'lesson' | 'ppt' | 'exam' | 'tutor' | 'course' | 'cheatsheet' | 'plan';
  id: string;
  title: string;
  subtitle: string;
  artifact_id?: string;
  download_url?: string;
  question_text?: string;
  subject?: string;
  grade_level?: string;
  cheatsheet_data?: CheatsheetData;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: AgentPlanStep[];
  tool_traces?: AgentToolTrace[];
  linked_items?: AgentLinkedItem[];
  needs_confirmation?: boolean;
  created_at: number;
}

export interface AgentThread {
  id: string;
  title: string;
  status: string;
  plan: AgentPlanStep[];
  pending_goal: string;
  artifacts: Record<string, string>;
  messages?: AgentMessage[];
  created_at: number;
  updated_at: number;
}

export interface LearnerWeakTopic {
  id: string;
  topic_tag: string;
  subject: string;
  grade_level: string;
  mastery_score: number;
  mistake_patterns: string[];
  practice_count: number;
  correct_count: number;
  due_review: boolean;
}

export interface TeacherPreferences {
  preferred_subject: string;
  preferred_grade: string;
  preferred_lesson_type: string;
  preferred_slide_count: string;
  preferred_theme: string;
  preferred_difficulty: string;
  [k: string]: string;
}

export interface SourceDocMeta {
  id: string;
  filename: string;
  title: string;
  char_count: number;
  chunk_count: number;
  quality_note: string;
  created_at: number;
}

export interface SourceChunkHit {
  id: string;
  doc_id: string;
  doc_title: string;
  chapter_title: string;
  chunk_index: number;
  content: string;
  score?: number;
}

export interface ExamSubmissionResult {
  id: string;
  exam_id: string;
  exam_title: string;
  score: number;
  total_score: number;
  duration_sec: number;
  logged_error_count: number;
  analytics_report_id: string;
  weak_topics: string[];
  item_results: {
    question_id: string;
    index: number;
    knowledge_point: string;
    earned: number;
    max_score: number;
    correct: boolean;
    feedback: string;
    correct_answer: string;
  }[];
}

export interface ErrorBookEntry {
  id: string;
  subject: string;
  grade_level: string;
  topic_tag: string;
  question_text: string;
  my_mistake: string;
  key_takeaway: string;
  mastery_level: number;
  created_at: number;
}

export interface StudyPlanDay {
  day: string;
  focus: string;
  task: string;
  minutes: number;
  checkpoint: string;
}

export interface StudyPlanRecord {
  id: string;
  title: string;
  goal: string;
  days: StudyPlanDay[];
  ics_artifact_id?: string;
  ics_artifact?: ArtifactItem;
  docx_artifact?: ArtifactItem;
}

export interface LessonStep {
  phase: string;
  duration: string;
  teacher_activity: string;
  student_activity: string;
  design_intent: string;
}

export interface LessonExercise {
  tier: string;
  question: string;
  solution: string;
}

export interface LessonContent {
  id?: string;
  title: string;
  subject: string;
  grade_level: string;
  lesson_type: string;
  duration: string;
  objectives: string[];
  learner_analysis: string;
  key_points: string;
  difficult_points: string;
  teaching_steps: LessonStep[];
  blackboard_design: string;
  exercises: LessonExercise[];
  verification_checklist: string[];
  edit_count?: number;
}

export interface LessonRecord {
  id: string;
  title: string;
  subject: string;
  grade_level: string;
  lesson_type: string;
  original_char_count: number;
  edited_char_delta: number;
  edit_count: number;
  artifact_id: string;
  content: LessonContent;
}

export interface EditableTextItem {
  id: string;
  role: string;
  text: string;
  style: string;
}

export interface PptSlide {
  slide_number: number;
  layout: string;
  kicker: string;
  title: string;
  subtitle: string;
  takeaway?: string;
  plot_expr?: string;
  chart_bars?: { label: string; value: number }[];
  cards?: Record<string, unknown>[];
  speaker_notes: string;
  svg_code: string;
  editable_texts: EditableTextItem[];
}

export interface PptAudit {
  slide_count: number;
  total_native_shapes: number;
  total_editable_text_boxes: number;
  slides_with_notes: number;
  native_verified: boolean;
}

export interface PptDeck {
  id: string;
  title: string;
  subject: string;
  grade_level: string;
  theme_id: string;
  slides: PptSlide[];
  pptx_audit: PptAudit;
  pptx_artifact_id: string;
  audio_artifact_id?: string;
  edit_count: number;
}

export interface PptTheme {
  id: string;
  name: string;
  short_name: string;
  subtitle: string;
  bg_primary: string;
  surface: string;
  border?: string;
  accent: string;
  ink_primary: string;
}

export interface DisciplineBranch {
  id: string;
  name: string;
  default_grade: string;
  topic_count?: number;
}

export interface DisciplineDomain {
  id: string;
  name: string;
  short_name: string;
  tagline: string;
  default_grades: string[];
  branches: DisciplineBranch[];
  topic_count?: number;
}

export interface SandboxPresetConfig {
  preset_id:
    | 'cubic_extrema'
    | 'logistic'
    | 'damped_wave'
    | 'michaelis'
    | 'bayes_ppv'
    | 'marginal_econ'
    | 'cyclic_group'
    | 'complex_surface'
    | 'custom'
    | 'saddle_3d'
    | 'lorenz_3d';
  expr?: string;
  params?: Record<string, number>;
  caption?: string;
  dimension?: '2d' | '3d' | 'phase' | 'mindmap';
}

export interface PedagogyTopic {
  id: string;
  domain_id?: string;
  domain_name?: string;
  branch?: string;
  title: string;
  subject: string;
  grade_level: string;
  bloom_level?: string;
  curriculum_standard?: string;
  core_formula_latex?: string;
  keywords: string[];
  intuition_models: { name: string; desc: string }[];
  teaching_flow: string[];
  micro_teaching_hook: string;
  pitfalls_and_counterexamples: string[];
  board_punchline: string;
  socratic_chain?: { step: string; question: string; insight: string }[];
  interdisciplinary_links?: { domain: string; title: string; mechanism: string }[];
  sandbox_preset?: SandboxPresetConfig;
  zhihu_reference_url: string;
}

export interface Surface3DData {
  ok: boolean;
  error?: string;
  expression: string;
  expr_latex: string;
  fx_latex: string;
  fy_latex: string;
  surface_feature: string;
  x_vals: number[];
  y_vals: number[];
  z_grid: (number | null)[][];
  z_domain: [number, number];
}

export type MindMapCategory = 'root' | 'principle' | 'intuition' | 'socratic' | 'pitfall' | 'interdisciplinary';

export interface MindMapNode {
  id: string;
  label: string;
  parent_id: string | null;
  level: number;
  side: 'center' | 'left' | 'right';
  category: MindMapCategory;
  note?: string;
  x?: number;
  y?: number;
  collapsed?: boolean;
}

export interface MindMapCrossLink {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface MindMapGraph {
  title: string;
  layout: 'mindmap_lr' | 'tree_right' | 'free';
  nodes: MindMapNode[];
  cross_links: MindMapCrossLink[];
}

export interface MindMapRecord {
  id: string;
  title: string;
  subject: string;
  domain_id: string;
  branch: string;
  graph: MindMapGraph;
  drawio_xml: string;
  artifact_id: string;
  artifact?: ArtifactItem;
}

export interface ExamQuestionPart {
  prompt: string;
  answer: string;
  explanation: string;
  points: number;
  minutes?: number;
}

export interface ExamQuestion {
  id: string;
  type: string;
  score: number;
  difficulty: string;
  knowledge_point: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  intent: string;
  parts?: ExamQuestionPart[];
  verification?: VerificationReport;
}

export interface ExamRecord {
  id: string;
  title: string;
  subject: string;
  grade_level: string;
  student_artifact_id: string;
  teacher_artifact_id: string;
  edit_count: number;
  exam: {
    id: string;
    title: string;
    subject: string;
    grade_level: string;
    total_score: number;
    duration_minutes: number;
    questions: ExamQuestion[];
  };
}

export interface AnalyticsReport {
  id: string;
  title: string;
  dataset_name: string;
  stats: {
    student_count: number;
    full_score: number;
    summary: {
      mean: number;
      median: number;
      std: number;
      q25: number;
      q75: number;
      min: number;
      max: number;
      pass_rate: number;
      excellent_rate: number;
    };
    distribution: { bucket: string; count: number }[];
    item_metrics: {
      item: string;
      full_score: number;
      mean_score: number;
      mastery_pct: number;
      discrimination: number;
      status: string;
    }[];
    cohorts: {
      excellence_count: number;
      steady_count: number;
      attention_count: number;
      attention_aliases: string[];
    };
  };
  ai_narrative: {
    overall_diagnosis: string;
    weakness_attribution: string;
    teaching_interventions: string[];
  };
  desensitize_summary: {
    student_count: number;
    dropped_columns: string[];
    masked_columns: string[];
    redacted_fields_count: number;
  };
  teacher_reviewed: boolean;
  teacher_note: string;
  artifact_id: string;
}

export interface TeachingTransferPayload {
  title: string;
  subject: string;
  grade_level: string;
  context_summary: string;
  target_tab: TeachTab;
}

export type HkRoute =
  | 'home'
  | 'courses'
  | 'calendar'
  | 'history'
  | 'marketplace'
  | 'kb'
  | 'course_space'
  | 'whiteboard'
  | 'cheatsheet'
  | 'tool_tutor'
  | 'tool_lesson'
  | 'tool_ppt'
  | 'tool_exam'
  | 'tool_analytics'
  | 'tool_mindmap';

export type HomeTab = 'craft' | 'instant';

export type LectureMastery = 'unstarted' | 'attempted' | 'familiar' | 'proficient' | 'mastered';

export interface BoardBlock {
  id: string;
  block_type?: 'concept' | 'derivation' | 'example' | 'trap' | 'summary';
  heading: string;
  lines: string[];
  highlight_note?: string;
  verified_badge?: string;
  narration?: string;
  teaching_tip?: string;
  visual_expr?: string;
}

export interface BoardPage {
  page_index: number;
  roadmap_title: string;
  blocks: BoardBlock[];
}

export interface WhiteboardMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  board_anchor_id?: string;
  created_at: number;
}

export interface LectureQuizItem {
  id: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  related_block_id?: string;
}

export interface LectureQuizSubmitResult {
  ok: boolean;
  score_pct: number;
  correct_count: number;
  total_count: number;
  mastery: LectureMastery;
  items: {
    id: string;
    selected: string;
    expected: string;
    correct: boolean;
    explanation: string;
    related_block_id?: string;
  }[];
  course: CourseRecord;
}

export interface CourseLecture {
  id: string;
  title: string;
  summary: string;
  kind: 'lecture' | 'quiz' | 'project';
  mastery: LectureMastery;
  duration_min: number;
  visualizer_preset?: string;
  board_pages: BoardPage[];
  messages: WhiteboardMessage[];
  quiz_items?: LectureQuizItem[];
}

export interface CourseUnit {
  unit_index: number;
  title: string;
  summary: string;
  lectures: CourseLecture[];
}

export interface CheatsheetItem {
  term: string;
  formula_or_rule: string;
  highlight_color: 'blue' | 'yellow' | 'none';
  trap_note: string;
}

export interface CheatsheetSection {
  title: string;
  badge: string;
  items: CheatsheetItem[];
}

export interface CheatsheetData {
  title: string;
  subtitle: string;
  sections: CheatsheetSection[];
}

export interface CourseRecord {
  id: string;
  title: string;
  subtitle: string;
  subject: string;
  grade_level: string;
  curator: string;
  source_label: string;
  cover_image: string;
  status: 'in_progress' | 'completed';
  progress_pct: number;
  mode: 'self_study' | 'teaching';
  description: string;
  units: CourseUnit[];
  cheatsheet: CheatsheetData;
  linked_ids: {
    lesson_id?: string;
    deck_id?: string;
    exam_id?: string;
    mindmap_id?: string;
    source_doc_ids?: string[];
  };
  weekly_sessions: Record<string, number>;
  last_lecture_id: string;
  next_lecture?: {
    id: string;
    title: string;
    kind: string;
    unit_index?: number;
  } | null;
  created_at: number;
  updated_at: number;
}

export interface WeeklyTracker {
  total_sessions: number;
  days: {
    label: string;
    date: string;
    count: number;
    is_today: boolean;
  }[];
  continue_learning: {
    course_id: string;
    course_title: string;
    lecture_id: string;
    lecture_title: string;
    kind: string;
  } | null;
}

export interface MarketplaceCourse {
  market_id: string;
  title: string;
  subject: string;
  grade_level: string;
  level: string;
  hours: string;
  category: string;
  cover_image: string;
  curator: string;
  description: string;
  featured?: boolean;
  size?: 'hero' | 'medium' | 'square' | 'card';
  topic_id?: string;
  mode?: 'self_study' | 'teaching';
}

export interface CalendarTaskItem {
  id: string;
  date_str: string;
  title: string;
  course_title: string;
  subject: string;
  minutes: number;
  completed: boolean;
  plan_id: string;
  created_at: number;
}

