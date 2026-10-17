# Sheshtkeh Beshtkeh beta deployment

One Java 25 process serves React, HTTP APIs, Admin and raw WebSockets. Exactly **one replica** is supported. Active games, matchmaking, AI sessions, display labels and HTTP/Admin sessions are in memory and are lost on restart, upgrade or rollback. SQLite guest credential hashes and analytics live under `/data`; retain and back up that volume. Display names also remain in browser storage. No database service or frontend proxy container is required.

## Build from source

Run commands from the repository root. Requirements: a Linux Docker engine (Docker Desktop Linux containers works), or Podman; builds download Node 24, Maven/Java 25 and dependencies. Docker builds run all frontend tests, the Vite build and `mvn -B -ntp clean verify`, then copy the executable JAR into a non-root Temurin 25 JRE image. The existing Maven resource configuration embeds `frontend/dist` into Spring Boot. No host Java/Node installation is needed to build the image.

```sh
docker build --progress=plain -t sheshtkeh-beshtkeh:0.1.0-beta .
docker image inspect sheshtkeh-beshtkeh:0.1.0-beta
```

For a committed source tree, prefer an immutable commit-qualified tag:

```sh
# POSIX shell; requires an existing Git commit. Commit the intended source first.
TAG="0.1.0-beta-$(git rev-parse --short=12 HEAD)"
docker build -t "sheshtkeh-beshtkeh:$TAG" .
```

PowerShell equivalent: `$tag = '0.1.0-beta-' + (git rev-parse --short=12 HEAD)` then `docker build -t "sheshtkeh-beshtkeh:$tag" .`. The initial D6 checkout had no Git commit, so its tested image uses `0.1.0-beta`; see [verification.md](verification.md) for the actual image identity. Record the built image digest alongside release values. Base image tags can receive updates; pin approved digests if byte-for-byte base selection is required. Re-run verification after rebuilding.

For host verification with Node 24, Java 25 and Maven 3.9+:

```sh
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
mvn -f backend/pom.xml -B -ntp clean verify
```

On Windows, a running JAR can lock Maven's target directory. Stop your own development server before cleaning, or build a separate source copy. Docker builds are isolated from that lock.

## Run with Compose

Compose runs the same production image, binds localhost port 8094 and persists `/data` in a named volume. It uses a read-only root, drops capabilities, prevents privilege escalation, allocates a writable `/tmp`, caps memory at 1 GiB/CPU at 2, and waits for readiness. An executable `/tmp` is required by SQLite JDBC's bundled native library; setting `noexec` prevents startup. The container runs as UID 10001/group 0 by default.

```sh
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml up -d --wait --wait-timeout 120
docker compose -f deploy/compose.yaml ps
curl --fail http://127.0.0.1:8094/actuator/health/readiness
docker compose -f deploy/compose.yaml logs -f
docker compose -f deploy/compose.yaml down
```

`down` keeps data; `down -v` destroys it. Never scale the Compose service. To change image, port or credentials, copy `deploy/.env.example` to an ignored private file (for example `deploy/.env`) and use:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --wait
```

The env file is optional; exported variables work too. Keep it private. Empty `SHESHTKEH_ADMIN_PASSWORD` leaves Admin unavailable while gameplay starts. Set a strong password to enable `/admin`; credentials never belong in Git. This local Compose profile explicitly enables `SHESHTKEH_ALLOW_INSECURE_HTTP=true` and disables Secure cookies because Docker forwarding changes the peer address from loopback to the bridge gateway. Keep the default localhost bind for this profile. Production rejects remote cleartext API/WebSocket requests by default. For a trusted HTTPS proxy deployment, set `SHESHTKEH_ALLOW_INSECURE_HTTP=false`, `SHESHTKEH_SECURE_COOKIES=true`, and configure trusted proxy addresses using Spring configuration as below. Do not expose the local HTTP profile publicly.

For extra Spring properties, mount a read-only configuration file and pass `--spring.config.additional-location=file:/config/application.yaml` via an ordinary Compose override, or use Spring environment variables. The standalone image defaults to production, address `0.0.0.0`, port `8080`, identity `/data/identity/guests.sqlite`, analytics `/data/analytics` and Secure cookies. `SERVER_PORT` changes its listener and image health check; update port mappings correspondingly. The Compose mapping deliberately fixes the container port to 8080.

## Smoke verification

With Node 24 on the machine running the container:

```sh
node deploy/smoke.mjs http://127.0.0.1:8094
# On an actual HTTPS deployment:
node deploy/smoke.mjs https://YOUR-ROUTE-HOST
```

The script verifies health groups, React/static assets, direct refresh of game/Admin routes, API namespaces, guest creation, private room creation, authenticated private/matchmaking WebSocket upgrades **and initial frames**, and anonymous Admin access denial. It creates a disposable guest/room; use it in beta or a test environment. To test real Admin login/logout as well, supply `SMOKE_ADMIN_PASSWORD` and optionally `SMOKE_ADMIN_USERNAME` in the shell environment. The script does not print credentials. Browser tests cover remembered Admin discovery, logout/remount persistence, failed authentication and collapsed/expanded navigation. A returning browser's Admin entry leads to the normal `/admin` login page; the storage flag grants no server authority.

For a controlled local router harness only, `SMOKE_PROXY_ORIGIN=https://beta.example.test` makes the script send that public Host/Origin and forwarded HTTPS headers to an HTTP transport URL. The source address must be in the configured trusted router range. It also verifies that an unforwarded remote HTTP API request is rejected and that returned cookies are Secure. This checks application proxy handling; use the actual HTTPS Route URL without this variable for real cluster verification.

## Save, transfer and load the image

```sh
docker save -o sheshtkeh-beta.tar sheshtkeh-beshtkeh:0.1.0-beta
# Transfer the TAR, then on the destination:
docker load -i sheshtkeh-beta.tar
docker image inspect sheshtkeh-beshtkeh:0.1.0-beta
```

Use `save/load`, not `export/import`: the latter discards image configuration. Prefer `-o`/`-i` over binary shell pipelines, especially in Windows PowerShell. Compare SHA-256 checksums after transfer (`Get-FileHash sheshtkeh-beta.tar -Algorithm SHA256` in PowerShell, `sha256sum sheshtkeh-beta.tar` on Linux).

Podman equivalents:

```sh
podman build -t sheshtkeh-beshtkeh:0.1.0-beta .
podman save --format docker-archive -o sheshtkeh-beta.tar sheshtkeh-beshtkeh:0.1.0-beta
podman load -i sheshtkeh-beta.tar
```

Podman image build/archive commands are provided for portability; the D6 verification used Docker. For Compose with Podman, install and verify a compatible Compose provider separately.

## Publish to Artifactory

Obtain the exact Docker registry endpoint, repository routing convention, approved tag and CA instructions from your organization. The following uses **example placeholders**, with repository-path routing. A subdomain-based Artifactory endpoint may instead include the repository in the hostname; use your administrator's address, not both conventions together. Do not disable TLS verification to bypass a private CA: install the approved CA in the Docker/Podman client/daemon trust configuration and on cluster nodes through your platform administrator.

```sh
# POSIX shell. Substitute your organization's values.
REGISTRY=artifactory.example.com
REPOSITORY=docker-local/sheshtkeh-beshtkeh
TAG=0.1.0-beta
REGISTRY_USER=YOUR-REGISTRY-USERNAME
docker login "$REGISTRY" --username "$REGISTRY_USER" --password-stdin < /private/path/registry-token
docker tag "sheshtkeh-beshtkeh:$TAG" "$REGISTRY/$REPOSITORY:$TAG"
docker push "$REGISTRY/$REPOSITORY:$TAG"
docker buildx imagetools inspect "$REGISTRY/$REPOSITORY:$TAG"
```

`docker login artifactory.example.com` also prompts securely. Podman provides matching `login`, `tag`, `push` and `manifest inspect` commands. PowerShell users can set `$registry`, `$repository`, `$tag` and use interactive `docker login $registry`; keep tokens out of command arguments/history. Save the published digest. No registry login, push or tag verification was performed against an organization registry during D6.

Use a scoped read-only pull account/token for the cluster. After authenticating a dedicated Docker config directory with only that registry, create a namespace-local image pull Secret from its config file, which must contain actual registry auth data (a desktop config containing only a credential-helper reference is insufficient):

```sh
oc project YOUR-BETA-NAMESPACE
oc create secret generic artifactory-pull --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson=/private/path/registry-docker-config.json
oc create secret generic sheshtkeh-admin \
  --from-file=password=/private/path/admin-password
```

The password file must contain exactly the password without a trailing newline. Treat Docker config JSON as a secret. Helm references these Secrets; it never logs into Artifactory and never creates plaintext password values. Secret env changes require a rollout restart. Application ConfigMap changes trigger a rollout through its checksum.

## Configure and deploy Helm on OpenShift

The chart follows Connect Fourtkeh's `deploy/helm/<application>/` conventions: external Spring YAML in `config/application.yaml`, checksum-mounted ConfigMap, named `http` Service, optional edge TLS Route, retained PVC, arbitrary UID, security contexts, writable temporary volume, probes and a single `Recreate` Deployment. Application-specific configuration and SQLite persistence have been adapted. Connect Fourtkeh was read-only throughout.

1. Edit `deploy/helm/sheshtkeh-beshtkeh/config/application.yaml` before packaging or deploying. It is ordinary Spring YAML. Configure admin username/session timeout, analytics release/retention/storage cap and trusted router source ranges. Keep database/analytics beneath the mounted `/data`; if changed, provide matching writable mounts. Listening port is controlled by `applicationPort` in values, propagated to the container and named probe port. Do not override that port independently in the Spring file.
2. Copy `deploy/examples/beta.values.yaml` to your private release values file. Replace `image.registry`, `image.repository`, `image.tag`, pull/Admin Secret names, Route host and StorageClass as appropriate. An empty Route host lets OpenShift allocate it. Route is off in defaults; the beta example enables it.
3. Authenticate to the intended cluster, choose the namespace, provision the Secrets and validate the manifests before applying.

```sh
helm lint deploy/helm/sheshtkeh-beshtkeh -f /private/path/beta.values.yaml
helm template beta deploy/helm/sheshtkeh-beshtkeh \
  --namespace YOUR-BETA-NAMESPACE -f /private/path/beta.values.yaml > beta.rendered.yaml
helm upgrade --install beta deploy/helm/sheshtkeh-beshtkeh \
  --namespace YOUR-BETA-NAMESPACE -f /private/path/beta.values.yaml \
  --wait --timeout 5m
oc rollout status deployment/beta-sheshtkeh-beshtkeh --timeout=180s
oc get deployment,pods,service,pvc -l app.kubernetes.io/instance=beta
oc get route beta-sheshtkeh-beshtkeh -o jsonpath='{.spec.host}'
oc logs deployment/beta-sheshtkeh-beshtkeh --tail=100 -f
```

Open `https://<host-from-oc-get-route>/` and `/admin`, and run the smoke script against that HTTPS origin. The chart needs no external Helm dependencies. Optional chart packaging: `helm package deploy/helm/sheshtkeh-beshtkeh`. To run the included matrix locally (PowerShell 7): `./deploy/verify-chart.ps1` or `./deploy/verify-chart.ps1 -Helm /path/to/helm`. It checks defaults, custom image/port, Secret refs, Route generated/explicit hosts, TLS on/off, persistence off/custom/existing and invalid replica/port/TLS settings. `helm lint/template` validate chart structure and schema; they do not prove cluster admission, DNS, certificates or volume permissions.

For ordinary Kubernetes set `route.enabled=false` and expose the ClusterIP using your existing ingress infrastructure; this chart does not install another ingress controller. A configurable OpenShift Route is the external exposure implemented here. Port-forwarding the strict production deployment over plain HTTP will reach health/frontend, but API/WS may require a trusted HTTPS proxy or a deliberately separate local HTTP test configuration.

### Route, TLS and WebSockets

Edge TLS terminates at OpenShift's router; the pod speaks HTTP. Route exposes all paths, including `/api`, `/ws` and `/admin`, through the same named port. Passthrough and re-encrypt are unsupported because the image does not configure backend TLS. OpenShift handles WebSocket upgrade; no path rewriting or additional service is needed. The default Route annotation requests a two-hour router timeout; confirm router policy permits it. Clients heartbeat and reconnect, but an idle connection may still close according to platform limits.

Production cookies remain Secure/HttpOnly/SameSite. `server.forward-headers-strategy=native` makes Tomcat honor forwarded scheme/client address from the configured trusted proxy networks. Narrow `server.tomcat.remoteip.internal-proxies` to the actual router addresses; preserve the original Host and strip/overwrite client-supplied forwarded headers at your edge. Restrict direct Service/pod access to trusted callers using your cluster's network policies. Correct forwarded scheme is necessary for same-origin HTTP mutations, WebSocket handshakes and HTTPS enforcement. Run an actual external HTTPS/WebSocket smoke test after deployment; a rendered Route alone cannot verify this.

### Storage and restricted security

Persistence defaults on. One PVC stores `/data/identity` and `/data/analytics`; the latter owns an exclusive filesystem lock. `persistence.existingClaim` reuses a PVC; disabled persistence mounts `emptyDir` and loses both stores when the pod is replaced. `storageClass: null` uses the cluster default, `""` requests no class. The generated PVC has Helm's keep policy and survives uninstall. To reinstall, reference the retained claim explicitly. Back it up before migrations or storage changes; shrinking/changing StorageClass is not an ordinary upgrade. For a simple consistent backup of both stores, stop the single writer before taking a storage snapshot/copy. Do not copy an active SQLite main file while ignoring its WAL.

The chart sets no fixed UID or privileged initialization. The cluster assigns the UID and approved volume group; your CSI driver/SCC must make `/data` writable by that UID/group. Existing claims must be provisioned accordingly. On ordinary Kubernetes, configure an allowed `podSecurityContext.fsGroup` if the storage driver requires it. Do not force a group forbidden by your OpenShift project allocation. There is no root chmod/chown init container. The read-only image root requires writable `/data` and `/tmp`; `/tmp` must allow SQLite native library loading. JVM heap uses 65% of the container limit; resources are initial beta budgets, not load-test results.

The chart schema rejects any `replicaCount` other than 1; no HPA exists, and `Recreate` prevents overlapping writers during normal upgrades. Separate Helm releases sharing a claim are also unsupported. Graceful shutdown allows up to 30 seconds for HTTP requests and analytics cleanup, within a 45-second pod termination grace period. Expect a short outage and loss of active game/Admin sessions on every replacement. Persisted credentials/analytics do not restore active matches.

## Operations and rollback

```sh
oc describe deployment beta-sheshtkeh-beshtkeh
oc describe pod POD-NAME
oc get events --sort-by=.lastTimestamp
oc get pvc
helm history beta --namespace YOUR-BETA-NAMESPACE
helm rollback beta REVISION --namespace YOUR-BETA-NAMESPACE --wait --timeout 5m
# After updating an environment-injected Secret:
oc rollout restart deployment/beta-sheshtkeh-beshtkeh
oc rollout status deployment/beta-sheshtkeh-beshtkeh --timeout=180s
```

Rollback also restarts the in-memory application; Helm rollback does not undo persisted data changes. Check image pull auth/CA/tag, Secret keys, pending PVCs, SCC admission and write permissions if startup fails. Only Actuator health is exposed, without details; analytics degradation appears in authenticated Admin storage diagnostics and is excluded from liveness/readiness groups. Retained PVCs and externally managed Secrets have a separate lifecycle from Helm uninstall.

## Required environment verification

Supply the real registry endpoint/repository, namespace, trusted router ranges, approved CA, Secret names and StorageClass. Push/inspect the tested image, install using your release values, verify PVC permissions under the assigned UID and confirm external HTTPS, Secure cookies, WebSocket frames and route refreshes. Test interruption/reconnection expectations with beta users. No OpenShift or Artifactory destination was supplied for D6; those environment checks remain manual. See [verification.md](verification.md) for completed local checks and exact artifacts.
