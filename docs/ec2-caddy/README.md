# EC2 Caddy Setup

This guide documents how to expose Open-Elevation on an EC2 host that already
has a Caddy container listening on ports `80` and `443`.

Target URL:

- `https://open-elevation.core.dasiot.site`

Current host assumptions:

- DNS `A` record points to the EC2 public IP.
- Existing Caddy container is already bound to host ports `80` and `443`.
- Open-Elevation runs with [docker-compose.ec2.yml](/Users/liyuncheng/workspace/beeinventor/dasiot-open-elevation/docker-compose.ec2.yml).
- Open-Elevation container listens on host port `8080`.

## 1. Start Open-Elevation

From the repo directory on the EC2 host:

```bash
docker compose -f docker-compose.ec2.yml up -d --build
```

Check that the API is reachable on the host:

```bash
curl http://127.0.0.1:8080/api/v1/lookup?locations=25.0339,121.5645
```

## 2. Find Caddy Config

```text
sudo docker ps
sudo docker inspect <caddy-container-id> | grep -i "config"

// should be located at /home/ubuntu/dasiot-live-call-server/caddy/Caddyfile
```

## 3. Update The Existing Caddy Config

On the EC2 host, the running Caddy container currently uses a Caddyfile like:

```caddy
{$HOST} {
  reverse_proxy signal-server:{$PORT}
}
```

Add a second site block for Open-Elevation:

```caddy
livecall.core.dasiot.site {
  reverse_proxy signal-server:9000
}

open-elevation.core.dasiot.site {
  reverse_proxy host.docker.internal:8080
}
```

If `host.docker.internal` is not available in that Caddy container, use the
host bridge IP instead. Common values are:

- `172.17.0.1`
- `172.18.0.1`

Example:

```caddy
open-elevation.core.dasiot.site {
  reverse_proxy 172.17.0.1:8080
}
```

## 4. Reload Caddy

If the live-call stack is managed by Docker Compose under
`/home/ubuntu/dasiot-live-call-server`:

```bash
cd /home/ubuntu/dasiot-live-call-server
docker compose up -d
```

Or reload the running container directly:

```bash
sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## 5. Verify HTTPS

```bash
curl -i https://open-elevation.core.dasiot.site/api/v1/lookup?locations=25.0339,121.5645
```

If certificate issuance is working, Caddy should automatically provision TLS
for `open-elevation.core.dasiot.site`.

## Troubleshooting

If HTTPS does not work, check these first:

- DNS resolves to the EC2 public IP.
- Security group allows inbound `80/tcp` and `443/tcp`.
- Host firewall is not blocking `80` or `443`.
- Open-Elevation is reachable locally on `127.0.0.1:8080`.
- Caddy logs do not show upstream connection errors.

Useful commands:

```bash
docker compose -f docker-compose.ec2.yml ps
docker compose -f docker-compose.ec2.yml logs -f
curl http://127.0.0.1:8080/api/v1/lookup?locations=22.2758,114.1455
sudo docker logs --tail 200 caddy
```
