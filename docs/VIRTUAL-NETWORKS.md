# Virtual networks

Open a project. Select **Virtual network** on a host card.

- The canvas shows the VMs and containers from that host.
- Add virtual switches. Drag between ports to make connections.
- Connect switches or VMs to **Physical uplink** to use the host's physical subnet.
- Select a VM to set a requested IPv4 address. Leave the field empty for automatic assignment.
- Select a connection or switch, then use **Delete** to remove it.
- Use **Save and assign IPs** to save immediately. The editor also saves changes automatically.
- Select **Back to project** to return to the physical network.

A VM does not forward traffic. A VM without a path to the uplink has no assigned IP address. The physical host must also have a path to a router. Virtual switches act as bridges. This editor does not configure separate virtual routers or routed subnets.

The first open creates a `vmbr0` switch and connects existing VMs to it. New VMs in an existing virtual network start without a link. Node positions, switch names, and connections are saved with the host. Project copies have their own VM IDs and connections.

## Local development

Start the backend, database, and IPAM service in Docker from the repository root:

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm ci --legacy-peer-deps
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. The API runs on `http://127.0.0.1:8080`. Vite reloads frontend changes automatically. The local database uses its own Docker volume. No database migration script is needed for this feature.

If port 8080 is in use, set `$env:LOCAL_BACKEND_PORT='8082'` before the Docker command. In the frontend terminal, set `$env:VITE_API_URL='http://127.0.0.1:8082'` before `npm run dev`.

## Checks in Docker

```powershell
docker build -f frontend/Dockerfile.test -t homelab-frontend-test frontend
docker run --rm homelab-frontend-test
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test
```

Virtual network data is stored in `nodes.details.virtual_network`. A VM's requested address is stored in `virtual_machines.details.static_ip`. The backend checks that each virtual endpoint belongs to the host. IPAM receives only VMs that can reach the uplink. Invalid requested addresses cause the complete save to fail without changing the saved project.
