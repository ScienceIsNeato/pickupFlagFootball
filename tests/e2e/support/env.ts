/** Fixed endpoints for the local e2e stack (see docker-compose.yml). High ports
 *  so they never clash with other dev stacks on this machine. */
export const E2E = {
  appPort: 3100,
  appBaseUrl: "http://127.0.0.1:3100",
  dbUrl: process.env.E2E_DB_URL ?? "postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test",
  smtpUrl: "smtp://127.0.0.1:11025",
  mailpitApi: "http://127.0.0.1:18025",
};
