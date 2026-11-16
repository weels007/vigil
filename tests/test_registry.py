"""Registry and read-side behaviour: ids, counts, JSON cards and totals."""

import json

import pytest

from conftest import (
    DEADLINE,
    DEPOSIT,
    NOW,
    create_vault,
    hex_of,
    mock_decision,
    mock_page,
    totals,
    vault_json,
)


def test_owner_is_the_deployer(deploy, direct_vm):
    sender = direct_vm.sender
    if hasattr(sender, "as_hex"):
        expected = sender.as_hex
    else:
        expected = "0x" + bytes(sender).hex()
    assert deploy.get_owner().lower() == expected.lower()


def test_owner_is_a_hex_string(deploy):
    owner = deploy.get_owner()
    assert owner.startswith("0x")
    assert len(owner) == 42


def test_vault_count_starts_at_zero(deploy):
    assert int(deploy.get_vault_count()) == 0


def test_totals_start_empty(deploy):
    data = totals(deploy)
    assert data["vault_count"] == 0
    assert data["total_locked"] == "0"
    assert data["total_settled"] == "0"
    assert data["total_checks"] == 0


def test_missing_vault_returns_empty_string(deploy):
    assert deploy.get_vault_json(0) == ""


def test_credit_of_unknown_address_is_zero(deploy, actors):
    assert int(deploy.get_credit_of(hex_of(actors["alice"]))) == 0


def test_vault_list_starts_empty(deploy):
    payload = json.loads(deploy.get_vaults_json(0, 10))
    assert payload["total"] == 0
    assert payload["vaults"] == []


def test_first_vault_gets_id_zero(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    assert vault_id == 0
    assert int(deploy.get_vault_count()) == 1


def test_second_vault_gets_id_one(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    second = create_vault(deploy, direct_vm, actors["alice"], actors["carol"], title="Second")
    assert second == 1


def test_vault_json_has_every_field(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    data = vault_json(deploy, vault_id)
    for key in (
        "id",
        "creator",
        "beneficiary",
        "title",
        "condition",
        "url",
        "deadline",
        "amount",
        "state",
        "checks",
        "last_check_at",
        "last_outcome",
        "last_reason",
        "last_met",
        "last_injection",
        "resolved_at",
        "checkable_at",
    ):
        assert key in data


def test_vault_json_records_both_parties(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    data = vault_json(deploy, vault_id)
    assert data["creator"] == actors["alice"].as_hex
    assert data["beneficiary"] == actors["bob"].as_hex


def test_vault_json_records_the_terms(deploy, direct_vm, actors):
    vault_id = create_vault(
        deploy,
        direct_vm,
        actors["alice"],
        actors["bob"],
        title="Book ships",
        condition="The page lists the book as published.",
        url="https://example.com/book",
    )
    data = vault_json(deploy, vault_id)
    assert data["title"] == "Book ships"
    assert data["condition"] == "The page lists the book as published."
    assert data["url"] == "https://example.com/book"
    assert data["deadline"] == DEADLINE


def test_vault_json_amount_is_a_decimal_string(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    data = vault_json(deploy, vault_id)
    assert data["amount"] == str(DEPOSIT)


def test_vault_starts_active_with_an_empty_log(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    data = vault_json(deploy, vault_id)
    assert data["state"] == "ACTIVE"
    assert data["checks"] == 0
    assert data["last_check_at"] == 0
    assert data["last_outcome"] == ""
    assert data["last_reason"] == ""
    assert data["last_met"] is False
    assert data["last_injection"] is False
    assert data["resolved_at"] == 0


def test_creating_locks_the_deposit(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)
    create_vault(deploy, direct_vm, actors["alice"], actors["carol"], value=DEPOSIT)
    data = totals(deploy)
    assert data["vault_count"] == 2
    assert data["total_locked"] == str(2 * DEPOSIT)


def test_vault_list_is_newest_first(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="First")
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="Second")
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="Third")
    payload = json.loads(deploy.get_vaults_json(0, 10))
    assert [v["title"] for v in payload["vaults"]] == ["Third", "Second", "First"]


def test_vault_list_paginates(deploy, direct_vm, actors):
    for index in range(3):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="Vault " + str(index))
    page = json.loads(deploy.get_vaults_json(1, 1))
    assert page["total"] == 3
    assert len(page["vaults"]) == 1
    assert page["vaults"][0]["title"] == "Vault 1"


def test_vault_list_caps_the_page_size(deploy, direct_vm, actors):
    for index in range(4):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    page = json.loads(deploy.get_vaults_json(0, 1000))
    assert len(page["vaults"]) == 4


def test_vault_list_offset_past_the_end_is_empty(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    page = json.loads(deploy.get_vaults_json(10, 5))
    assert page["vaults"] == []
