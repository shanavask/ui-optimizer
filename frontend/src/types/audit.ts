export type PageAudit = {
  url: string;
  page_type: string;
  best_practices: string[];
  audit_status?: "completed" | "in_progress";
  audit_result?: string;
  screenshot?: string;
  redo_screenshot?: string;
  eyeshot?: string;
  clarity?: string;
};

export type Competitor = {
  competitor_name: string;
  competitor_url: string;
};

export type UIAuditResponse = {
  company_name: string;
  vertical: string;
  competitors?: Competitor[];
  pages: PageAudit[];
  message: string;
  guestimate?: string;
};

export type SlideFinding = {
  category?: string;
  problem_discovered: string;
  description_of_problem: string;
  status?: string;
  reasoning?: string;
  score: number;
};

export type SlideRecommendation = {
  recommendation?: string;
  priority?: string;
  action?: string;
  impact?: string;
};

export type SlideMediaMetrics = {
  media_spend?: number;
  media_traffic?: number;
  media_transactions?: number;
  revenue_per_sale?: number;
  currency?: string;
  current_cvr?: number;
  cvr_lift?: number;
  projected_cvr?: number;
  revenue_opp?: number;
  annual_cost?: number;
  roi_percentage?: number;
};

export type CompetitorArtifact = {
  exists: boolean;
  screenshot?: string;
  result?: string;
};

export type SlideReport = {
  final_score?: number;
  url?: string;
  vertical?: string;
  clientName?: string;
  status?: string;
  executive_summary?: string;
  media_metrics?: SlideMediaMetrics;
  findings?: SlideFinding[];
  recommendations?: SlideRecommendation[];
};
