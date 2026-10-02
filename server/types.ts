export type User = { id: string; name: string; email: string };
export type Citation = {
  label: number;
  paper_id: string;
  chunk_id: string;
  title: string;
  page: number;
  section: string | null;
  excerpt: string;
};
export type AnalysisField = { text: string; pages: number[] };
export type PaperAnalysis = Record<
  | "summary"
  | "contributions"
  | "methodology"
  | "datasets"
  | "model"
  | "results"
  | "limitations"
  | "future_work",
  AnalysisField
>;
export type Paper = {
  id: string;
  title: string;
  filename: string;
  file_size: number;
  authors: string[];
  year: number | null;
  tags: string[];
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  page_count: number | null;
  analysis: PaperAnalysis | null;
  created_at: string;
  updated_at: string;
  collection_ids?: string[];
};
export type Collection = { id: string; name: string; paper_count: number };
export type Conversation = {
  id: string;
  title: string;
  mode: "chat" | "compare";
  paper_ids: string[];
  updated_at: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  citations: Citation[];
  error: string | null;
};
export type GraphData = {
  nodes: { id: string; title: string; tags: string[]; year: number | null }[];
  edges: {
    source: string;
    target: string;
    kind: "topic" | "similarity";
    weight: number;
    label: string;
  }[];
};
