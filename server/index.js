const express = require("express");
const { RecaptchaEnterpriseServiceClient } = require("@google-cloud/recaptcha-enterprise");

const app = express();

app.use(express.json({ limit: "1mb" }));

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const PROJECT_ID = requiredEnv("GCLOUD_PROJECT_ID");
// Your pasted Java uses a hardcoded recaptchaKey; with enterprise assessment
// the token is validated server-side, so key is only needed client-side.
// We still keep the env var so you can cross-check in logs if desired.
const EXPECTED_ACTION_ALLOWLIST = (process.env.EXPECTED_ACTION_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);

// Cache client (recommended)
const client = new RecaptchaEnterpriseServiceClient();

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/recaptcha-verify", async (req, res) => {
  try {
    const { token, action } = req.body || {};

    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, reason: "Missing/invalid token" });
    }
    if (!action || typeof action !== "string") {
      return res.status(400).json({ ok: false, reason: "Missing/invalid action" });
    }

    // Optional hardening: ensure you only allow known actions.
    if (EXPECTED_ACTION_ALLOWLIST.length > 0 && !EXPECTED_ACTION_ALLOWLIST.includes(action)) {
      return res.status(403).json({ ok: false, reason: "Action not allowed" });
    }

    // === This is the Node equivalent of your pasted Java CreateAssessment logic ===
    // It calls RecaptchaEnterpriseServiceClient#createAssessment with event(siteKey, token)
    // Note: siteKey is required by the enterprise API event; we expect it via env.
    const RECAPTCHA_SITE_KEY = requiredEnv("RECAPTCHA_ENTERPRISE_SITE_KEY");

    const parent = `projects/${PROJECT_ID}`;

    const [response] = await client.createAssessment({
      parent,
      assessment: {
        event: {
          siteKey: RECAPTCHA_SITE_KEY,
          token,
        },
        // You can add additional fields here if needed.
      },
    });

    const tokenValid = !!response.tokenProperties?.valid;
    if (!tokenValid) {
      const reasonName = response.tokenProperties?.invalidReason?.toString?.() || "INVALID";
      return res.status(200).json({ ok: false, reason: `Invalid token: ${reasonName}` });
    }

    const responseAction = response.tokenProperties?.action;
    if (String(responseAction) !== String(action)) {
      return res.status(200).json({
        ok: false,
        reason: `Action mismatch (expected ${action}, got ${responseAction})`
      });
    }

    // If you want: log risk reasons (do not expose to client)
    // console.log(response.riskAnalysis);

    return res.status(200).json({ ok: true, score: response.riskAnalysis?.score ?? null });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: err?.message || "Server error" });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Recaptcha backend listening on http://localhost:${PORT}`);
});

