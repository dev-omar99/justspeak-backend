# JustSpeak Backend (`justspeak_backend`)

NestJS + TypeScript + Prisma + PostgreSQL + Socket.IO backend for the **JustSpeak** 1-on-1 English speaking practice platform.

## Architecture & Modules

- **`AuthModule` (`src/auth`)**: Email/phone signup & login, cryptographically secure OTP generation (`crypto.randomInt`) & atomic single-use verification, server-side Google ID token verification (`google-auth-library`), and JWT authentication (`JwtAuthGuard`).
- **`RoomsModule` (`src/rooms`)**: Mutex-serialized 1-on-1 matchmaking queue, session creation, authorized room membership tracking, and authenticated WebRTC Socket.IO signaling gateway (`SignalingGateway`).
- **`FeedbackModule` (`src/feedback`)**: Post-session peer feedback with strict session & participant authorization and duplicate-submission protection.
- **`UsersModule` (`src/users`)**: User dashboard, daily ticket quota & 24-hour reset, streak calculation, buddies, blocklist, and global/tribe leaderboards.
- **`AdminModule` (`src/admin`)**: Admin-only user management and platform statistics guarded by `AdminGuard` (cleans up associated OTP records upon user deletion).
- **`AiPartnerModule` (`src/ai-partner`)**: AI speaking partner: live voice sessions over Socket.IO (Deepgram speech-to-text, an OpenAI-compatible chat provider for the coach loop, ElevenLabs text-to-speech), goal-driven roleplay scenarios, deterministic word-choice analytics, scored session reports, recording upload/playback, and per-plan session quotas. Feature-flagged by `JUSTSPEAK_AI_ENABLED`; see `src/ai-partner/ai-partner.config.ts` for every knob.
- **`PrismaModule` (`src/prisma.module.ts`)**: Global singleton `PrismaService` managing the PostgreSQL connection pool.

## Environment Variables

Configure these in `justspeak_backend/.env` (see [`.env.example`](file:///c:/Users/A%20S%20U%20S/Desktop/My%20App/justspeak_backend/.env.example)):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for the primary database |
| `SHADOW_DATABASE_URL` | Dev / Migrate | Separate PostgreSQL database used only as Prisma's shadow DB |
| `JWT_SECRET` | Yes | Secret key used to sign and verify 24-hour user JWTs |
| `GOOGLE_CLIENT_ID` | For Google Auth | Google OAuth 2.0 Web Client ID verified by `OAuth2Client.verifyIdToken` |
| `PORT` | Optional | HTTP & WebSocket server port (default `3000` in code, `4000` in `.env.example`) |
| `CORS_ORIGINS` | Recommended | Comma-separated list of allowed frontend origins for HTTP and Socket.IO CORS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional (Prod) | Nodemailer SMTP settings for real email OTP delivery |

## Security & Real-Time Assumptions

1. **Authentication & Account Ownership**:
   - Email signup sets `emailVerified = false` until verified via OTP (`POST /auth/verify-otp`).
   - Google Sign-In (`POST /auth/google`) validates the Google ID token signature, audience, issuer, and `email_verified` claim server-side, and refuses (`409 Conflict`) to auto-link an existing account whose `emailVerified` is `false`.
   - `JwtAuthGuard` and `SignalingGateway` verify JWT validity and confirm the user account still exists in PostgreSQL.
2. **OTP Protection**:
   - 6-digit OTPs are generated via `crypto.randomInt(100000, 1000000)`, never logged to stdout, expire after 10 minutes, lock after 5 failed attempts, and are consumed atomically via compare-and-swap (`updateMany`).
   - HTTP rate limits (`@nestjs/throttler`) and per-identifier sliding-window limits (60s cooldown, max 5 requests per 15 minutes) protect `/auth/*` routes.
3. **Matchmaking Queue & Session TTL Behavior**:
   - `RoomsService.joinQueue` and `leaveQueue` are serialized through an in-process FIFO mutex (`withQueueLock`).
   - Matched rooms are held in `matchedRooms` with a 2-minute claim TTL (`matchedRoomTtlMs`) and registered in `roomRegistry` with a 60-minute session TTL (`defaultRoomTtlMs`).
   - Every created `Session` persists its authorized `participantIds` (`TEXT[] NOT NULL`) in PostgreSQL. If the backend process restarts during an active 60-minute session, `SignalingGateway.handleJoinRoom` automatically recovers room authorization from `Session.participantIds` and `Session.createdAt`.

## Database Migration Prerequisites & Safe Execution

1. Always validate schema changes and new migrations against an isolated test database (`justspeak_migration_test`) before applying to `justspeak_db`:
   ```bash
   npx prisma migrate status
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
   ```
2. Never run `prisma migrate reset` or `prisma db push` against `justspeak_db`.
3. Once approved, apply pending migrations non-destructively via:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

## Running & Testing

```bash
# development server
npm run start:dev

# unit & concurrency regression tests
npm test

# TypeScript typecheck & production build
npx tsc --noEmit -p tsconfig.json
npm run build
```
