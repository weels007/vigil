"""Money paths: cancel, refund, withdraw, credits and double-settlement safety."""

from conftest import (
    DEADLINE,
    DEPOSIT,
    DEPOSIT_TWO,
    NOW,
    create_vault,
    hex_of,
    install_payout_spy,
    mock_decision,
    mock_page,
    totals,
    vault_json,
    warp,
)


def test_cancel_credits_the_creator(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    assert deploy.cancel_vault(vault_id) == "CANCELLED"
    assert int(deploy.get_credit_of(hex_of(actors["alice"]))) == DEPOSIT
    assert int(deploy.get_credit_of(hex_of(actors["bob"]))) == 0


def test_cancel_marks_the_vault_cancelled(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    data = vault_json(deploy, vault_id)
    assert data["state"] == "CANCELLED"
    assert data["resolved_at"] == NOW


def test_cancel_moves_the_totals(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    data = totals(deploy)
    assert data["total_locked"] == "0"
    assert data["total_cancelled"] == str(DEPOSIT)


def test_only_the_creator_can_cancel(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    direct_vm.sender = actors["bob"]
    with direct_vm.expect_revert("only the creator"):
        deploy.cancel_vault(vault_id)


def test_cannot_cancel_after_settlement(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(vault_id)
    direct_vm.sender = actors["alice"]
    with direct_vm.expect_revert("vault is not active"):
        deploy.cancel_vault(vault_id)


def test_cannot_cancel_twice(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    with direct_vm.expect_revert("vault is not active"):
        deploy.cancel_vault(vault_id)


def test_refund_before_the_deadline_is_rejected(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    warp(direct_vm, DEADLINE - 1)
    with direct_vm.expect_revert("deadline has not passed"):
        deploy.refund_vault(vault_id)


def test_refund_at_the_deadline_succeeds(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    warp(direct_vm, DEADLINE)
    assert deploy.refund_vault(vault_id) == "REFUNDED"


def test_refund_credits_the_creator(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    warp(direct_vm, DEADLINE)
    deploy.refund_vault(vault_id)
    assert int(deploy.get_credit_of(hex_of(actors["alice"]))) == DEPOSIT
    data = totals(deploy)
    assert data["total_refunded"] == str(DEPOSIT)
    assert data["total_locked"] == "0"


def test_refund_is_permissionless(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    warp(direct_vm, DEADLINE + 10)
    direct_vm.sender = actors["carol"]
    assert deploy.refund_vault(vault_id) == "REFUNDED"
    assert vault_json(deploy, vault_id)["state"] == "REFUNDED"


def test_cannot_refund_twice(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    warp(direct_vm, DEADLINE)
    deploy.refund_vault(vault_id)
    with direct_vm.expect_revert("vault is not active"):
        deploy.refund_vault(vault_id)


def test_cannot_refund_a_cancelled_vault(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    warp(direct_vm, DEADLINE)
    with direct_vm.expect_revert("vault is not active"):
        deploy.refund_vault(vault_id)


def test_cannot_refund_a_triggered_vault(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(vault_id)
    warp(direct_vm, DEADLINE)
    with direct_vm.expect_revert("vault is not active"):
        deploy.refund_vault(vault_id)


def test_withdraw_pays_the_credit(deploy, direct_vm, actors):
    spy = install_payout_spy()
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    assert deploy.withdraw() == "WITHDRAWN"
    assert spy == [(actors["alice"].as_hex, DEPOSIT)]


def test_withdraw_zeroes_the_credit(deploy, direct_vm, actors):
    install_payout_spy()
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    deploy.withdraw()
    assert int(deploy.get_credit_of(hex_of(actors["alice"]))) == 0


def test_withdraw_counts_the_payout(deploy, direct_vm, actors):
    install_payout_spy()
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    deploy.withdraw()
    assert totals(deploy)["total_withdrawn"] == str(DEPOSIT)


def test_cannot_withdraw_twice(deploy, direct_vm, actors):
    install_payout_spy()
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    deploy.cancel_vault(vault_id)
    deploy.withdraw()
    with direct_vm.expect_revert("nothing to withdraw"):
        deploy.withdraw()


def test_cannot_withdraw_without_credit(deploy, direct_vm, actors):
    direct_vm.sender = actors["carol"]
    with direct_vm.expect_revert("nothing to withdraw"):
        deploy.withdraw()


def test_beneficiary_withdraws_after_settlement(deploy, direct_vm, actors):
    spy = install_payout_spy()
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(vault_id)
    direct_vm.sender = actors["bob"]
    deploy.withdraw()
    assert spy == [(actors["bob"].as_hex, DEPOSIT)]


def test_settlement_cannot_happen_twice(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"])
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(vault_id)
    with direct_vm.expect_revert("vault is not active"):
        deploy.check_vault(vault_id)
    assert int(deploy.get_credit_of(hex_of(actors["bob"]))) == DEPOSIT


def test_credits_accumulate_across_vaults(deploy, direct_vm, actors):
    first = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)
    second = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT_TWO)
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(first)
    direct_vm.clear_mocks()
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(second)
    assert int(deploy.get_credit_of(hex_of(actors["bob"]))) == DEPOSIT + DEPOSIT_TWO


def test_one_withdraw_pays_every_credit(deploy, direct_vm, actors):
    spy = install_payout_spy()
    first = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)
    second = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT_TWO)
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(first)
    direct_vm.clear_mocks()
    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(second)
    direct_vm.sender = actors["bob"]
    deploy.withdraw()
    assert spy == [(actors["bob"].as_hex, DEPOSIT + DEPOSIT_TWO)]


def test_full_lifecycle_accounting(deploy, direct_vm, actors):
    settled = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)
    cancelled = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)
    refunded = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=DEPOSIT)

    mock_page(direct_vm)
    mock_decision(direct_vm, met=True)
    deploy.check_vault(settled)

    deploy.cancel_vault(cancelled)

    warp(direct_vm, DEADLINE)
    deploy.refund_vault(refunded)

    data = totals(deploy)
    assert data["vault_count"] == 3
    assert data["total_locked"] == "0"
    assert data["total_settled"] == str(DEPOSIT)
    assert data["total_cancelled"] == str(DEPOSIT)
    assert data["total_refunded"] == str(DEPOSIT)
    assert int(deploy.get_credit_of(hex_of(actors["bob"]))) == DEPOSIT
    assert int(deploy.get_credit_of(hex_of(actors["alice"]))) == 2 * DEPOSIT
