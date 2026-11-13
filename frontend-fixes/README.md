# Frontend Fixes Package (`ballotsfrntnd`)

These files mirror and extend the frontend application (`https://github.com/yuriEGV/ballotsfrntnd.git`):

1. `vercel.json` — SPA fallback rewrite so direct routes (`/vote/:id`, `/plaza`, `/encuestas`, `/client-dashboard`, `/admin-dashboard`) return `200 OK` on refresh instead of `404`.
2. `src/App.jsx` — Registers `/plaza` and `/encuestas` routes pointing to `PlazaCiudadana`.
3. `src/utils/pricing.js` — Shared CLP pricing catalog and tiered calculator for formal elections (`Votación`) and civic surveys (`Encuesta`), plus module pricing (`Asamblea Virtual`, `Soporte Técnico`, `Paquete Completo de Auditorías`).
4. `src/pages/LandingPage.jsx` — Ordered pricing cards (`Encuesta Ciudadana`, `Votación Formal`, `Paquete Completo de Auditorías`) and prominent CTAs to `Plaza Ciudadana` (`/plaza`).
5. `src/components/QuoteForm.jsx` — Interactive cotizador supporting both elections and surveys with real-time itemized CLP breakdown.
6. `src/pages/PlazaCiudadana.jsx` — Public survey portal (`/plaza` and `/encuestas`) featuring points badge header, `Home`, `Encuestas`, `Recompensas`, `Mis datos`, and `Historial` views, multi-question and candidate-based Web3-anchored participation (`nullifierHash` + Polygon Amoy), live result bars, real coupon reward redemption, and session-aware navigation links.
7. `src/pages/Login.jsx` — Session verification via `GET /api/auth/me`, safe `?next=` redirect handling (so logged-in users or new registrations go straight to their requested workflow), and quick navigation links back to `/` and `/plaza`.
8. `src/pages/VotingGateway.jsx` — Clear UX handling OTP verification (`votingKey`), duplicate RUT rejection (`409`), and Web3 verification.
9. `src/pages/VotingBooth.jsx` — Supports both candidate voting and multi-question surveys with cryptographic `ballotCommitment`, `txHash`, and Polygonscan verification link.
10. `src/pages/ClientDashboard.jsx` — Removes unconditional admin review warning (only requests admin evaluation when `Paquete Completo de Auditorías` is selected), supports creating/configuring both `Votación Formal` and `Encuesta Ciudadana`, `?new=survey` auto-open support, Plaza Ciudadana publishing, itemized pricing, manual status controls (`draft` Pendiente/Pausada, `active` Activa, `ended` Apagada/Finalizada), `401` session expiration handling, admin panel shortcut, and question results in Actas.
11. `src/pages/AdminDashboard.jsx` — Filters pending evaluations to `Paquete Completo de Auditorías`, shows process modality/Plaza/price badges, inline election status selector (`Pendiente / Pausada`, `Activa`, `Apagada / Finalizada`), full User CRUD modals (`POST /api/users`, `PUT /api/users/:id`, valid `'organizer'` role toggle, delete), sidebar shortcuts to create surveys/elections and Plaza Ciudadana, survey question results, and full Web3 audit receipts.
