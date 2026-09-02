# Hustlr reCAPTCHA Enterprise Backend

This backend implements `POST /api/recaptcha-verify` for the existing frontend `auth.js`.

## Environment variables
- `GCLOUD_PROJECT_ID`
- `RECAPTCHA_ENTERPRISE_SITE_KEY`
- `EXPECTED_ACTION_ALLOWLIST` (optional)

## Google credentials (required)
This service account auth must be available to the process at runtime.
Common options:
- Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of a service account JSON file
- Or use your hosting provider's built-in Google auth.

## Local run
```bash
cd server
npm install
copy .env.example .env
# edit .env
npm start
```

Then test:
```bash
curl -X POST http://localhost:3001/api/recaptcha-verify \
  -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN_FROM_BROWSER>","action":"LOGIN"}'
```

