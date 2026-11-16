"""Shared helpers for the Vigil direct-mode test suite.

Direct mode runs the contract in-process: no Docker, no network, no validator set.
Every web and LLM call must be mocked, and time is controlled with direct_vm.warp.
"""

import json
import sys
from datetime import datetime, timezone

import pytest

CONTRACT_PATH = "contracts/vigil.py"

# 2030-01-01T00:00:00Z, the instant every test starts from.
NOW = 1893456000
DAY = 86400
DEADLINE = NOW + 7 * DAY

# 0.01 GEN
DEPOSIT = 10**16
DEPOSIT_TWO = 3 * 10**16

PAGE_BODY = (
    "<html><head><title>Aurora</title></head><body>"
    "<h1>Project Aurora</h1><p>Project Aurora has shipped its first release today.</p>"
    "</body></html>"
)


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def warp(vm, ts: int) -> None:
    vm.warp(iso(ts))


@pytest.fixture
def deploy(direct_vm, direct_deploy):
    warp(direct_vm, NOW)
    return direct_deploy(CONTRACT_PATH)


@pytest.fixture
def actors(deploy):
    from gltest.direct import create_address

    return {
        "alice": create_address("alice"),
        "bob": create_address("bob"),
        "carol": create_address("carol"),
    }


def hex_of(addr) -> str:
    return addr.as_hex


def mock_page(vm, body: str = PAGE_BODY, status: int = 200, pattern: str = r".*example\.com.*") -> None:
    vm.mock_web(pattern, {"status": status, "body": body})


def mock_decision(
    vm,
    met: bool = False,
    injection: bool = False,
    unverifiable: bool = False,
    confidence: int = 85,
    reason: str = "the page was reviewed",
    pattern: str = r".*Vigil.*",
) -> None:
    payload = {
        "met": met,
        "unverifiable": unverifiable,
        "injection_suspected": injection,
        "confidence": confidence,
        "reason": reason,
    }
    vm.mock_llm(pattern, json.dumps(payload))


def mock_llm_raw(vm, raw: str, pattern: str = r".*Vigil.*") -> None:
    vm.mock_llm(pattern, raw)


def create_vault(
    contract,
    vm,
    creator,
    beneficiary,
    *,
    title: str = "Aurora ships",
    condition: str = "The page announces that Project Aurora has shipped its first release.",
    url: str = "https://example.com/aurora",
    deadline: int = DEADLINE,
    value: int = DEPOSIT,
) -> int:
    vm.sender = creator
    vm.value = value
    try:
        vault_id = contract.create_vault(hex_of(beneficiary), title, condition, url, deadline)
    finally:
        vm.value = 0
    return int(vault_id)


def vault_json(contract, vault_id: int) -> dict:
    raw = contract.get_vault_json(vault_id)
    assert raw != ""
    return json.loads(raw)


def totals(contract) -> dict:
    return json.loads(contract.get_totals())


def install_payout_spy() -> list:
    """Replace the module-level GEN payout with a recorder.

    Direct mode has no chain layer, so emitting the external transfer would fail.
    The spy records what withdraw() asked to send without changing any other logic.
    """
    module = sys.modules.get("_contract_vigil")
    assert module is not None, "contract module is not loaded"
    calls = []

    def _record(to, amount):
        calls.append((to.as_hex, int(amount)))

    module._send_gen = _record
    return calls
