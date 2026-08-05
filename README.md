# LabCD Admin Starter

Admin platform starter for LabCD (FastAPI + React + PostgreSQL). Interns develop new modules inside the **admin** section after signing in.

**Stack:** FastAPI + React + PostgreSQL (Docker Compose).

---

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env — change JWT_SECRET and ADMIN_PASSWORD

docker compose up --build
```

| Service   | URL                         |
|-----------|-----------------------------|
| Frontend  | http://localhost:5173       |
| API docs  | http://localhost:8000/docs  |
| Postgres  | localhost:5432 (from `.env`)|

Default admin (from `.env`): `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

After login you land on `/admin`.

Stop:

```bash
docker compose down
```

---

## Local development

### 1. Environment

```bash
cp .env.example .env
# Set JWT_SECRET and ADMIN_PASSWORD
```

### 2. Database

```bash
docker compose up db -d
```

`DATABASE_URL` in `.env` should point at `localhost` when the API runs on the host.

### 3. Python API

Python **3.11+** recommended.

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn backend_api.http.main:app --reload --host 0.0.0.0 --port 8000
```

API: http://localhost:8000  
OpenAPI: http://localhost:8000/docs

### 4. React frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Dev server: http://localhost:5173  
Vite proxies `/api` → `http://localhost:8000`.

---

## Project layout

```
LabCD-Phase-1-31/
├── backend_api/           # FastAPI backend
│   ├── http/              # Routers, schemas, services
│   │   ├── routers/       # Thin route handlers
│   │   ├── schemas/       # Pydantic models
│   │   ├── services/      # Auth, admin, CMS, monitoring
│   │   ├── config.py
│   │   └── main.py
│   ├── db/                # SQLAlchemy models + session
│   └── common/            # Shared helpers
├── frontend/              # React + Vite + Tailwind
│   └── src/
│       ├── api/           # HTTP client, endpoints, types
│       ├── pages/         # Login, register, Admin* pages
│       ├── components/    # Shared UI + admin layout
│       ├── context/       # Auth, theme
│       └── hooks/
├── docker-compose.yml
├── Dockerfile.api
├── requirements.txt
├── .env.example
└── AGENTS.md
```

---

## Adding an admin module

Use existing modules (Users, Plans, Blog, Survey, …) as examples.

1. **Backend schema** — add Pydantic models in `backend_api/http/schemas/`.
2. **Backend service** — put business logic in `backend_api/http/services/<name>_service.py`.
3. **Backend router** — thin handlers in `backend_api/http/routers/<name>.py` using `Depends(require_admin)`.
4. **Register router** — `app.include_router(...)` in [`backend_api/http/main.py`](backend_api/http/main.py).
5. **Frontend API** — add helpers in `frontend/src/api/endpoints.ts` (+ types in `types.ts`).
6. **Frontend page** — create `frontend/src/pages/AdminYourModulePage.tsx`.
7. **Route** — add a child route under `/admin` in [`frontend/src/App.tsx`](frontend/src/App.tsx).
8. **Sidebar** — add an entry to `navItems` in [`frontend/src/components/admin/AdminLayout.tsx`](frontend/src/components/admin/AdminLayout.tsx).

Keep business logic on the server. React should only render and call the API.

---

## Where business logic lives

| Concern | Location |
|---------|----------|
| HTTP routes | `backend_api/http/routers/` |
| Request/response shapes | `backend_api/http/schemas/` |
| Auth, admin CRUD, CMS, monitoring | `backend_api/http/services/` |
| Persistence | `backend_api/db/` |
| UI only | `frontend/src/` |

---

## Environment variables

See `.env.example`. Important ones:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection |
| `JWT_SECRET` | Auth signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin account |
| `CORS_ORIGINS` | Allowed frontend origins |
| `RESULTS_DIR` / `UPLOADS_DIR` | Artifact / upload paths |
| `VITE_API_BASE_URL` | Frontend API base (`frontend/.env`) |

Never commit `.env`. Commit only `.env.example`.

---

## Coding rules

See [AGENTS.md](./AGENTS.md): keep functions small, avoid duplication, use env vars, never put business logic in React.

---

## Team checklist before push

- [ ] No secrets in the diff (`.env`, keys, passwords)
- [ ] No user uploads / results / avatars committed
- [ ] API changes reflected in OpenAPI (`/docs`) and frontend types
- [ ] Business logic stays in `backend_api`, not React

---

## License

See [LICENSE](./LICENSE).
