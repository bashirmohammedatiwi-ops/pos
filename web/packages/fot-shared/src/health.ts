export type ApiHealth = {
  status: string;
  database?: string;
  timestamp?: string;
  schemaVersion?: number | null;
  schemaName?: string | null;
  schemaTableExists?: boolean;
  bundledSchemaVersion?: number;
  pendingMigrations?: number;
  error?: string;
};

export type HealthzReport = {
  status: string;
  schemaVersion?: number | null;
  bundledSchemaVersion?: number;
  pendingMigrations?: number;
  checks: Record<string, { status: string; description?: string | null }>;
};
