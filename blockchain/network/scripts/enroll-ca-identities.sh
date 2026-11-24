#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_environment

CA_CERT="/etc/hyperledger/fabric-ca-server/ca-cert.pem"
CLIENT_ROOT="/var/hyperledger/fabric-ca/clients"

enroll_identity() {
  local service="$1"
  local caname="$2"
  local identity="$3"
  local secret_name="$4"
  local role="$5"
  local organization="$6"
  local ca_storage="$7"
  local client_home="$CLIENT_ROOT/$organization/users/$identity"
  local host_home="$PROJECT_ROOT/blockchain/organizations/ca-clients/$ca_storage/$organization/users/$identity"
  local ca_certificate="cacerts/localhost-7054-${caname}.pem"
  local secret

  secret="$(env_value "$secret_name")"
  mkdir -p "$host_home"
  if [[ ! -f "$host_home/msp/signcerts/cert.pem" ]]; then
    if ! compose exec -T \
      -e FABRIC_CA_CLIENT_HOME="$CLIENT_ROOT/admin" \
      "$service" fabric-ca-client identity list \
      --id "$identity" \
      --caname "$caname" \
      --url "https://localhost:7054" \
      --tls.certfiles "$CA_CERT" >/dev/null 2>&1; then
      if ! compose exec -T \
        -e FABRIC_CA_CLIENT_HOME="$CLIENT_ROOT/admin" \
        "$service" fabric-ca-client register \
        --caname "$caname" \
        --url "https://localhost:7054" \
        --id.name "$identity" \
        --id.secret "$secret" \
        --id.type client \
        --id.attrs "role=$role:ecert,org=$organization:ecert,canWrite=true:ecert" \
        --tls.certfiles "$CA_CERT" >/dev/null 2>&1; then
        printf 'CA registration failed for %s; verify CA availability and the local registrar identity.\n' "$identity" >&2
        exit 1
      fi
    fi

    if ! compose exec -T \
      -e FABRIC_CA_CLIENT_HOME="$client_home" \
      "$service" fabric-ca-client enroll \
      --caname "$caname" \
      --url "https://$identity:$secret@localhost:7054" \
      --tls.certfiles "$CA_CERT" >/dev/null 2>&1; then
      printf 'CA enrollment failed for %s; verify its local secret and the CA TLS certificate.\n' "$identity" >&2
      exit 1
    fi
  else
    printf 'Identity %s is already enrolled.\n' "$identity"
  fi

  cat > "$host_home/msp/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: $ca_certificate
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: $ca_certificate
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: $ca_certificate
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: $ca_certificate
    OrganizationalUnitIdentifier: orderer
EOF
}

enroll_ca_admin() {
  local service="$1"
  local caname="$2"
  local password_name="$3"
  local organization="$4"
  local password
  local host_home="$PROJECT_ROOT/blockchain/organizations/ca-clients/$organization/admin"

  password="$(env_value "$password_name")"
  mkdir -p "$host_home"
  if [[ ! -f "$host_home/msp/signcerts/cert.pem" ]]; then
    if ! compose exec -T \
      -e FABRIC_CA_CLIENT_HOME="$CLIENT_ROOT/admin" \
      "$service" fabric-ca-client enroll \
      --caname "$caname" \
      --url "https://admin:$password@localhost:7054" \
      --tls.certfiles "$CA_CERT" >/dev/null 2>&1; then
      printf 'CA bootstrap enrollment failed for %s; verify the local bootstrap secret and CA TLS certificate.\n' "$caname" >&2
      exit 1
    fi
  fi
}

copy_ca_root_to_msp() {
  local service="$1"
  local organization_domain="$2"
  local ca_filename="$3"
  local host_msp="$PROJECT_ROOT/blockchain/organizations/crypto-config/peerOrganizations/$organization_domain/msp/cacerts"

  mkdir -p "$host_msp"
  docker cp "$FABRIC_PROJECT-$service-1:$CA_CERT" "$host_msp/$ca_filename"
  cat > "$(dirname "$host_msp")/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/$ca_filename
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/ca.$organization_domain-cert.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/ca.$organization_domain-cert.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/ca.$organization_domain-cert.pem
    OrganizationalUnitIdentifier: orderer
EOF
}

enroll_ca_admin ca-harvest ca-harvest CA_HARVEST_BOOTSTRAP_PASSWORD harvest
enroll_ca_admin ca-processing ca-processing CA_PROCESSING_BOOTSTRAP_PASSWORD processing
enroll_ca_admin ca-distribution ca-distribution CA_DISTRIBUTION_BOOTSTRAP_PASSWORD distribution

enroll_identity ca-harvest ca-harvest harvest.operator HARVEST_OPERATOR_ENROLLMENT_SECRET harvest_operator OrgHarvest harvest
enroll_identity ca-processing ca-processing processing.operator PROCESSING_OPERATOR_ENROLLMENT_SECRET processing_operator OrgProcessing processing
enroll_identity ca-processing ca-processing quality.inspector QUALITY_INSPECTOR_ENROLLMENT_SECRET quality_inspector OrgProcessing processing
enroll_identity ca-distribution ca-distribution distributor.operator DISTRIBUTOR_ENROLLMENT_SECRET distributor OrgDistribution distribution

copy_ca_root_to_msp ca-harvest org-harvest.example.com ca-harvest.pem
copy_ca_root_to_msp ca-processing org-processing.example.com ca-processing.pem
copy_ca_root_to_msp ca-distribution org-distribution.example.com ca-distribution.pem

printf 'Three Fabric CAs and four organization-scoped application identities are enrolled.\n'
