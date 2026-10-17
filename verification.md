# Gate D6 verification — 17 October 2026

## Built artifacts

- Docker image **actually built**: `sheshtkeh-beshtkeh:0.1.0-beta`, Linux amd64, reported image size 144,458,043 bytes, default user `10001:0`.
- Docker-reported image ID: `sha256:f5e65ea50b6c5b49eaa357857239aecdeb84ba9500c036c7c346284dca8bd248`.
- Portable image archive: `artifacts/sheshtkeh-beta.tar`, 144,477,696 bytes. `docker save` and `docker load` both succeeded; the loaded tag has the same image ID.
- Archive SHA-256: `ab466916ab9eccf75279f936f9673a2f47cc445c447735c9a7f40d91b1fa3e87`.
- Packaged chart: `artifacts/sheshtkeh-beshtkeh-0.1.0-beta.1.tgz`.
- No commit suffix: the supplied repository had an unborn HEAD and its source was untracked. No commit or publication was created by D6.

These artifacts are ignored local outputs. Rebuild/export for another architecture or after source changes; retain the archive checksum with a transferred release.

## Completed checks

| Check | Result |
| --- | --- |
| Frontend focused Admin tests | 47 passed across provider, Admin page and lobby/navigation suites. |
| Full frontend tests and build | 356 tests passed; TypeScript/Vite build passed on host and in the Docker build. Vite reports existing large chunks. |
| Maven clean verify in Linux image build | 71 domain + 225 application tests passed; executable JAR packaged with React. |
| Maven clean verify on Windows | Same 296 tests passed in an isolated source copy with normal networking/filesystem access. The original target JAR was locked by an existing development process, which was left running. |
| Production Docker build | Passed with real Docker Desktop Linux engine. |
| Compose config | Passed for defaults and an explicit private env file. |
| Compose startup | Healthy with a read-only root, writable persistent `/data`, executable temporary mount, dropped capabilities and no privilege escalation. |
| HTTP/application smoke | Health/liveness/readiness UP; frontend and HTML-linked assets served; game/Admin direct refresh routes return the SPA; unknown API and non-health Actuator paths do not become SPA content. |
| Gameplay transport smoke | Guest/profile/room creation and both private-room and matchmaking WebSocket 101 upgrades plus valid initial application frames passed. |
| Admin authentication smoke | Disposable password injected through environment; session CSRF login, authenticated status, logout and subsequent 401 passed. No password/session credential stored in localStorage. |
| Graceful restart and storage | Stop completed cleanly; SQLite and analytics files persisted; the same volume restarted healthy and passed the smoke suite again. |
| Arbitrary UID/custom port | UID `1000650000:0`, port 9090, read-only root, `/data` volume and exact chart Spring ConfigMap file passed startup and image health. |
| Trusted HTTPS forwarding harness | Direct remote cleartext rejected with 426. Simulated trusted router forwarded scheme/Host accepted; Secure cookies, HTTP mutations, private/matchmaking WebSocket frames and Admin login/logout passed. This exercised application forwarding, not real network TLS. |
| Helm lint/template | Passed using the existing read-only Helm executable from Connect Fourtkeh's local tools. |
| Helm matrix | Defaults; custom registry/repository/tag and application port; image pull and Admin Secret references; generated/explicit/disabled Route; TLS on/off; new/custom/existing/disabled persistence; beta example. Invalid replicas, privileged port and passthrough TLS were rejected. |
| Helm package | Chart archive produced successfully. |
| TAR save/load | Passed; image ID unchanged after loading. |

The first startup test found a missing health-check `curl` and a non-executable tmpfs that prevented SQLite JDBC native loading; both were corrected and the final startup checks passed. Docker port forwarding also exposed the existing remote-HTTPS requirement; Compose now explicitly opts into local-only HTTP, while production keeps HTTPS enforcement by default. Unit tests cover that distinction.

Relevant local logs: `artifacts/gate-d6-image-build.log`, `artifacts/gate-d6-maven-isolated.log`, `artifacts/gate-d6-helm-beta.yaml`. Test containers, disposable volumes and temporary test credentials were removed after verification. The image, TAR, chart package and verification outputs remain available.

## Connect Fourtkeh reuse

Reviewed its Dockerfile, multi-stage build/test flow, `.dockerignore`, Compose, chart templates/schema, external Spring configuration, Service/Route, Secret refs, persistence, probes, resource/security defaults, image conventions and release guide. Reused the chart helper/labels/selectors, single-replica `Recreate` strategy, configuration checksum, named port, startup/readiness/liveness probes, retained PVC, optional edge Route, pull Secrets, non-root/root-group image pattern and writable temporary volume. Adapted Maven reactor paths, app properties, registry/port values and durable SQLite storage. Did not copy its Compose default password. **No Connect Fourtkeh files were modified.**

## Remaining manual steps

1. Obtain the actual Artifactory registry/repository, credentials and CA policy. Load the TAR if needed, log in, tag, push and inspect the published tag/digest using [README.md](README.md).
2. Authenticate to the intended OpenShift cluster/namespace. Create namespace-local registry/Admin Secrets from private files; choose the approved StorageClass and ensure the PVC is writable under the project's assigned UID/group.
3. Copy/edit the beta values example and chart Spring configuration, including image tag, router proxy addresses, Route/DNS and analytics release. Run lint/template, then the documented `helm upgrade --install`.
4. Check admission, image pull, PVC binding, rollout, logs and generated Route. Run `node deploy/smoke.mjs https://YOUR-ROUTE-HOST` with optional private Admin test credentials; verify actual TLS, Secure cookies, WebSocket longevity/reconnection and browser refreshes from outside the cluster.

No organization Artifactory or OpenShift target/access was supplied, and neither environment was mutated. Podman commands are documented but were not executed. Exactly one replica remains mandatory; every restart/upgrade/rollback loses active in-memory games and sessions. Storage backup, cluster ownership policy, certificates, CA trust, DNS and router behavior require environment verification.
