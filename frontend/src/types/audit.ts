export type PageAudit = {
  url: string;
  page_type: string;
  best_practices: string[];
  audit_status?: "completed" | "in_progress";
  audit_result?: string;
  screenshot?: string;
  eyeshot?: string;
};

export type UIAuditResponse = {
  company_name: string;
  vertical: string;
  pages: PageAudit[];
  message: string;
  guestimate?: string;
};
