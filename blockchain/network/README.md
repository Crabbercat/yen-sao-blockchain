# Hyperledger Fabric network

This folder bootstraps the local Fabric 2.5 network used by the prototype.
The deployment uses three Fabric CAs, three peers, a three-node Raft ordering
service and one channel, `supplychannel`. Peers use Fabric's default LevelDB
state database. All Fabric services use TLS and run on a dedicated internal
Docker bridge; no CA, peer, orderer or operations port is published to the
host.

The network is a single-host lab, not a production or multi-host deployment.
The three Raft orderers demonstrate the topology but do not provide
host-level fault tolerance. Node MSP/TLS material and channel artifacts are
generated locally and excluded from Git. CA bootstrap and enrollment secrets
belong only in the ignored root `.env`.

Peer containers mount the local Docker Engine socket so Fabric can launch
chaincode runtime containers on the same internal network. This grants peer
containers broad control over the local Docker daemon and is for this
disposable development lab only; the application backend does not mount the
socket.

From WSL2 Debian (Docker Desktop WSL integration enabled), run from the
repository root:

```bash
cp .env.example .env
# Replace every placeholder with a distinct local random value.
./blockchain/network/scripts/check-prerequisites.sh
./blockchain/network/scripts/deploy.sh
./blockchain/network/scripts/health-check.sh
```

`deploy.sh` generates node certificates, starts the three CAs, enrolls
organization-scoped CA identities, starts peers/orderers, creates the
application channel block, joins every orderer and peer, and verifies channel
participation. The first run downloads pinned Docker images and needs network
access.

Use `./blockchain/network/scripts/down.sh` to stop containers while preserving
ledger/CA volumes and identities. The reset script refuses to run unless
`--confirm-delete-lab-state` is supplied; it then deletes only this Fabric
project's named volumes and generated files.

The images are pinned to Fabric `2.5.16` and Fabric CA `1.5.17`. Application
identities are enrolled by their respective CAs; `crypto-config` provides
node MSP/TLS material for the peers and Raft orderers. The CA signing roots
are added to the corresponding peer organization MSP so CA-enrolled client
certificates can be validated by channel members.
