import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  storageDriver: process.env.STORAGE_DRIVER || "memory",
  defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  n8nToApiSecret: process.env.N8N_TO_API_SECRET || "",
  apiToN8nSecret: process.env.API_TO_N8N_SECRET || "",
  notificationWebhookUrl: process.env.N8N_NOTIFICATION_WEBHOOK_URL || "",
  timezone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
  schedulerEnabled: process.env.SCHEDULER_ENABLED !== "false",
  schedulerIntervalSeconds: Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60)
};
