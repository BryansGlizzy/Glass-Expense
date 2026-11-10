#!/usr/bin/env bash
# Runs the end-to-end encryption test suites against a throwaway server and database.
#   npm test
# Nothing here touches your real data/, .env secrets, SMTP, Firebase or Google credentials.
set -u
cd "$(dirname "$0")/.."

PORT="${TEST_PORT:-3930}"
DATA_DIR="$(mktemp -d)"
LOG="$DATA_DIR/server.log"
export TEST_BASE="http://localhost:$PORT" DATA_DIR

NODE_ENV=production MODE=saas PORT="$PORT" APP_URL="$TEST_BASE" DATA_DIR="$DATA_DIR" \
JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')" SERVER_WRAP_KEY="$(openssl rand -base64 32)" \
EMAIL_CAPTURE_DIR="$DATA_DIR/mail" KDF_MIN_ITERATIONS=1000 RATE_LIMIT_MULTIPLIER=200 ADMIN_EMAIL=admin@example.com \
AI_ALLOWED_HOSTS="localhost:3999,127.0.0.1:3999" INVOICE_EMAIL_DAILY_LIMIT=8 \
SMTP_HOST= SMTP_USER= SMTP_PASS= FIREBASE_SERVICE_ACCOUNT_PATH=/nonexistent \
GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y GOOGLE_REDIRECT_URI="$TEST_BASE/cb" \
  npx tsx server/index.ts > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$DATA_DIR"' EXIT

for _ in $(seq 1 40); do curl -sf "$TEST_BASE/api/info" >/dev/null && break; sleep 0.5; done
curl -sf "$TEST_BASE/api/info" >/dev/null || { echo "Server failed to start:"; cat "$LOG"; exit 1; }

status=0
# Invoicing 2.0 (docs/DOCUMENTATION.md). The pure suites (invoice.*) need no server but run here so one command covers everything.
for t in crypto server.e2ee client.e2ee migration examples reports agent agent.invoices ai.relay mailer invoice.e2ee invoice.core invoice.sheet invoice.sheetpdf invoice.logo invoice.ge invoice.dynamic invoice.ui; do
  f="tests/$t.test.ts"; [ -f "$f" ] || f="tests/$t.test.tsx"
  echo "━━ $f"
  npx tsx "$f" 2>&1 | grep -v -i "deprecat" | grep -v "trace-deprecation" || true
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
done
[ $status -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME TESTS FAILED"
exit $status
