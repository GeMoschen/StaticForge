// Dev-only reverse proxy for `npm start` (ng serve). Proxies `/api` to a separately
// running backend so the frontend can be iterated on without rebuilding or rebundling
// through Spring Boot.
//
// Configure the backend URL via the SF_API_URL environment variable:
//
//   SF_API_URL=http://localhost:8080 npm start
//
// Defaults to http://localhost:8080 when unset.
const target = process.env.SF_API_URL || 'http://localhost:8080';

export default [
  {
    context: ['/api'],
    target,
    secure: false,
    changeOrigin: true,
  },
];
