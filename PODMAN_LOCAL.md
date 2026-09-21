# Local Podman deployment

Start the complete local stack:

```powershell
.\scripts\podman-up.ps1
```

Services:

- `cloudzero-digital-twin`: application, available only at `127.0.0.1:3000`.
- `cloudzero-postgres`: PostgreSQL 17, available only at `127.0.0.1:5432`.
- `cloudzero-command-proxy`: internal gRPC simulation proxy with no host port.

Check status:

```powershell
.\scripts\podman-status.ps1
```

Stop containers without deleting data:

```powershell
.\scripts\podman-down.ps1
```

PostgreSQL data is stored in the named `cloudzero_postgres_data` volume. The
schema under `db/init` is applied only when that volume is first initialized.
Incident domain events are stored in `incident_events` as an append-only,
hash-chained ledger. The app refuses startup if persisted chain integrity fails.

The credentials in `compose.yaml` are local-development credentials. Do not use
them outside an isolated workstation. Production must inject `DATABASE_URL`
through the deployment secret mechanism, must not publish database port 5432,
and should use TLS, backups, point-in-time recovery, and a restricted app role.
