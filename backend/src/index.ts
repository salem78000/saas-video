import "dotenv/config";
import express from "express";
import cors from "cors";
import { projectRoutes } from "./routes/projects.js";
import { shotRoutes } from "./routes/shots.js";
import { renderRoutes } from "./routes/renders.js";
import { connectionRoutes } from "./routes/connections.js";
import { webhookRoutes } from "./routes/webhooks.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));

// Webhooks must be mounted BEFORE express.json() — they need raw body for HMAC
app.use("/webhooks", webhookRoutes);             // Provider callbacks (spec §14)

app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/connections", connectionRoutes);  // BYOK API keys (spec §3)
app.use("/api/projects", projectRoutes);        // Projects + wizard (spec §9-11)
app.use("/api/shots", shotRoutes);              // Shot plans (spec §5, §11)
app.use("/api/renders", renderRoutes);          // Render jobs + versions (spec §14-15)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
