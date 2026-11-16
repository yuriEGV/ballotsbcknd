# Frontend Fixes Package (`ballotsfrntnd`)

These files mirror and extend the frontend application (`https://github.com/yuriEGV/ballotsfrntnd.git`):

1. `vercel.json` — SPA fallback rewrites, asset immutable caching, and production HTTP security headers (`CSP`, `HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, standardized `Permissions-Policy`).
2. `vite.config.js` & `index.html` — Spanish metadata, API/CDN preconnect hints, and vendor chunk splitting (`vendor-react`, `vendor-icons`, `vendor-http`).
3. `src/App.jsx` — Route-based `React.lazy()` code splitting + `<Suspense>` loader and `/plaza`, `/encuestas`, `*` fallback routes.
4. `src/utils/pricing.js` — Shared CLP pricing catalog and tiered calculator for formal elections (`Votación`) and civic surveys (`Encuesta`), plus module pricing (`Asamblea Virtual`, `Soporte Técnico`, `Paquete Completo de Auditorías`).
5. `src/pages/LandingPage.jsx` — Ordered pricing cards, session-aware top nav CTA, and optimized hero media attributes.
6. `src/components/QuoteForm.jsx` — Interactive cotizador supporting both elections and surveys with real-time itemized CLP breakdown.
7. `src/pages/PlazaCiudadana.jsx` — Authenticated citizen survey portal (`/plaza` and `/encuestas`) with Citizen Sign-In / Sign-Up gate (`POST /api/plaza/auth/login`, `/register`, `/bridge`), blocking guest access until logged in, plus `Home`, `Encuestas`, `Recompensas`, `Mis datos`, `Historial`, multi-question Web3 participation (`nullifierHash` + Polygon Amoy), live results, and coupon redemption.
8. `src/pages/Login.jsx` — Session verification via `GET /api/auth/me`, safe `?next=` redirect handling, and quick navigation links back to `/` and `/plaza`.
9. `src/pages/VotingGateway.jsx` — Clear UX handling OTP verification (`votingKey`), duplicate RUT rejection (`409`), and Web3 verification.
10. `src/pages/VotingBooth.jsx` — Supports both candidate voting and multi-question surveys with cryptographic `ballotCommitment`, `txHash`, and safe external Polygonscan links (`noopener noreferrer`).
11. `src/pages/ClientDashboard.jsx` — Removes unconditional admin review warning (only requests admin evaluation when `Paquete Completo de Auditorías` is selected), supports creating/configuring both `Votación Formal` and `Encuesta Ciudadana`, `?new=survey` auto-open support, `useDeferredValue` search filtering, Plaza Ciudadana publishing, itemized pricing, manual status controls (`draft`, `active`, `ended`), `401` session handling, admin panel shortcut, and question results in Actas.
12. `src/pages/AdminDashboard.jsx` — Enforces client-side admin role verification (`403` / non-admin redirect), filters pending evaluations to `Paquete Completo de Auditorías`, inline election status selector, full User CRUD modals, sidebar shortcuts, survey question results, and Web3 audit receipts.
